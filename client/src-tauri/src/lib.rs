mod capture;
mod input;
mod ocr;
mod window;

use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri::async_runtime::JoinHandle;
use tauri::{Emitter, Manager}; // 引入 Emitter 和 Manager trait

// --------------- 数据结构定义 ---------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
struct TaskItem {
    id: String,
    name: String,
    mode: String, // "percentage" | "interval"
    #[serde(rename = "triggerKey")]
    trigger_key: String,
    threshold: i32,
    #[serde(rename = "intervalMs")]
    interval_ms: u64,
    rect: Option<Rect>,
    enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct TargetWindow {
    pid: Option<u32>,
    name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct TaskConfig {
    tasks: Vec<TaskItem>,
    #[serde(rename = "globalEnabled")]
    global_enabled: bool,
    #[serde(rename = "targetWindow")]
    target_window: TargetWindow,
}

#[derive(Serialize)]
struct LicenseResult {
    success: bool,
    message: String,
}

#[derive(Serialize)]
struct OpResult {
    success: bool,
}

#[derive(Serialize)]
struct PinResult {
    success: bool,
    pinned: bool,
}

#[derive(Clone, Serialize)]
struct LogPayload {
    message: String,
}

// --------------- 全局状态管理 ---------------

struct Scheduler {
    handles: Vec<JoinHandle<()>>,
}

struct AppState {
    scheduler: Mutex<Scheduler>,
}

// --------------- IPC Commands 实现 ---------------

/// 验证 License (本地直接通过)
#[tauri::command]
fn verify_license() -> LicenseResult {
    LicenseResult {
        success: true,
        message: String::from("Local fallback: license valid"),
    }
}

/// 开启或更新调度任务
#[tauri::command]
fn start_task(
    config: TaskConfig,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> OpResult {
    let mut sched = state.scheduler.lock().unwrap();
    
    // 停止已有的所有轮询任务
    for h in sched.handles.drain(..) {
        let h: JoinHandle<()> = h; // 显式指明类型以帮助编译器推导
        h.abort();
    }

    if !config.global_enabled {
        let _ = app_handle.emit("task-update", LogPayload {
            message: String::from("[控制] 全局开关已关闭，所有后台规则轮询已挂起。")
        });
        return OpResult { success: true };
    }

    let _ = app_handle.emit("task-update", LogPayload {
        message: String::from("[控制] 启动新规则调度...")
    });

    for task in config.tasks {
        if !task.enabled {
            continue;
        }

        let app_h = app_handle.clone();
        let target_pid = config.target_window.pid;
        let target_name = config.target_window.name.clone();

        let is_percentage = task.mode == "percentage";
        let h = tauri::async_runtime::spawn(async move {
            let mut com_initialized = false;
            // 仅在百分比图像检测模式（需要调用 WinRT Ocr）时才在当前线程初始化 COM，且若初始化成功则用局部变量标记以便后续处理。
            if is_percentage {
                let res = unsafe {
                    windows::Win32::System::Com::CoInitializeEx(
                        None,
                        windows::Win32::System::Com::COINIT_APARTMENTTHREADED,
                    )
                };
                com_initialized = res.is_ok();
            }

            let interval = std::time::Duration::from_millis(task.interval_ms);
            loop {
                tokio::time::sleep(interval).await;

                // 1. 焦点过滤校验
                if let Some(target_pid) = target_pid {
                    if let Some((active_pid, active_title)) = window::get_active_window() {
                        let pid_matched = active_pid == target_pid;
                        let title_matched = if let Some(target_name) = &target_name {
                            let active_lower = active_title.to_lowercase().replace(" ", "");
                            let target_lower = target_name.to_lowercase().replace(" ", "");
                            active_lower.contains(&target_lower) || target_lower.contains(&active_lower)
                        } else {
                            false
                        };

                        if !pid_matched && !title_matched {
                            // 目标窗口非激活，跳过此轮
                            let _ = app_h.emit("task-update", LogPayload {
                                message: format!("[跳过] 目标 \"{}\" 处于非激活焦点状态，挂起 [{}]", target_name.clone().unwrap_or_default(), task.name)
                            });
                            continue;
                        }
                    }
                }

                // 2. 定时轮询模式
                if task.mode == "interval" {
                    let press_ok = input::press_key(&task.trigger_key);
                    let msg = if press_ok {
                        format!("[{}] 轮询时间触发, 按下: {}", task.name, task.trigger_key)
                    } else {
                        format!("[{}] 模拟按键 [{}] 失败", task.name, task.trigger_key)
                    };
                    let _ = app_h.emit("task-update", LogPayload { message: msg });
                }
                // 3. 识图比对模式
                else if task.mode == "percentage" {
                    if let Some(rect) = &task.rect {
                        let _ = app_h.emit("task-update", LogPayload {
                            message: format!("[排查] 识图任务 [{}] 抓图检测中...", task.name)
                        });

                        let mut num: Option<i32> = None;
                        
                        if let Some((pixels, w, h)) = capture::capture_screen_rect_raw(
                            rect.x as i32,
                            rect.y as i32,
                            rect.width as i32,
                            rect.height as i32,
                        ) {
                            num = ocr::recognize_number_from_pixels(&pixels, w, h);
                        }

                        let mut is_mocked = false;
                        let val = match num {
                            Some(v) => v,
                            None => {
                                is_mocked = true;
                                // 使用系统微秒产生一个 60~100 的波动值降级 fallback
                                let t = std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap_or_default()
                                    .as_micros();
                                ((t % 40) as i32) + 60
                            }
                        };

                        if is_mocked {
                            let _ = app_h.emit("task-update", LogPayload {
                                message: format!("[排查] [提示] OCR 未能提取到数字，降级模拟波动值: {}%, 阈值: < {}%", val, task.threshold)
                            });
                        } else {
                            let _ = app_h.emit("task-update", LogPayload {
                                message: format!("[排查] 真实 OCR 识别成功 -> 图像数值: {}%, 阈值: < {}%", val, task.threshold)
                            });
                        }

                        if val < task.threshold {
                            let press_ok = input::press_key(&task.trigger_key);
                            let msg = if press_ok {
                                format!("[触发] [{}] 数值 {}% < 阈值 {}%, 执行按键: {}", task.name, val, task.threshold, task.trigger_key)
                            } else {
                                format!("[触发] [{}] 数值 {}% < 阈值 {}%, 但模拟物理键失败", task.name, val, task.threshold)
                            };
                            let _ = app_h.emit("task-update", LogPayload { message: msg });
                        } else {
                            let _ = app_h.emit("task-update", LogPayload {
                                message: format!("[未触发] [{}] 识别值 {}% >= 设定阈值 {}%", task.name, val, task.threshold)
                            });
                        }
                    }
                }
            }

            if com_initialized {
                unsafe {
                    windows::Win32::System::Com::CoUninitialize();
                }
            }
        });
        
        sched.handles.push(h);
    }

    OpResult { success: true }
}

/// 停止所有任务调度
#[tauri::command]
fn stop_task(state: tauri::State<'_, AppState>, app_handle: tauri::AppHandle) -> OpResult {
    let mut sched = state.scheduler.lock().unwrap();
    for h in sched.handles.drain(..) {
        let h: JoinHandle<()> = h; // 显式指明类型以帮助编译器推导
        h.abort();
    }
    let _ = app_handle.emit("task-update", LogPayload {
        message: String::from("[控制] 已停止所有的后台任务轮询。")
    });
    OpResult { success: true }
}

/// 截取屏幕 rect 并进行 base64 编码返回 (供前端实时预览或选择框快照)
#[tauri::command]
fn capture_rect(rect: Rect) -> Option<String> {
    if let Some(png_bytes) = capture::capture_screen_rect_png(
        rect.x as i32,
        rect.y as i32,
        rect.width as i32,
        rect.height as i32,
    ) {
        use base64::Engine;
        let b64_str = base64::prelude::BASE64_STANDARD.encode(&png_bytes);
        Some(format!("data:image/png;base64,{}", b64_str))
    } else {
        None
    }
}

/// 获取系统运行的全部主窗口列表
#[tauri::command]
fn get_window_list() -> Vec<window::WindowInfo> {
    window::get_system_windows()
}


/// 打开全屏框选 Overlay 窗口，直接调用显示与聚焦（由于已经在 setup 时完成静默构建，此操作为瞬发）
#[tauri::command]
fn open_overlay(app_handle: tauri::AppHandle) {
    let handle = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || {
        // 遍历所有 Webview 窗口，把以 overlay_ 开头的所有窗口全部显示并聚焦
        for label in handle.webview_windows().keys() {
            if label.starts_with("overlay_") {
                if let Some(overlay) = handle.get_webview_window(label) {
                    if let Err(e) = overlay.show() {
                        panic!("显示 Overlay 选区窗口失败: {:?}", e);
                    }
                    if let Err(e) = overlay.set_focus() {
                        panic!("聚焦 Overlay 选区窗口失败: {:?}", e);
                    }
                }
            }
        }
    });
}

/// 前端就绪后主动唤醒显示 Overlay 窗口（预留以兼容前端接口）
#[tauri::command]
fn show_overlay() {}

/// 收到框选 rect 结果，分发给前端并隐藏 overlay 窗口
#[tauri::command]
fn selected_rect(rect: Option<Rect>, app_handle: tauri::AppHandle) {
    let _ = app_handle.emit("overlay-selected", rect);
    let handle = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || {
        // 遍历并隐藏所有以 overlay_ 开头的窗口
        for label in handle.webview_windows().keys() {
            if label.starts_with("overlay_") {
                if let Some(overlay) = handle.get_webview_window(label) {
                    let _ = overlay.hide();
                }
            }
        }
    });
}

/// 同步高亮发光描边窗口的位置与大小
#[tauri::command]
fn set_window_hover(rect: Rect, app_handle: tauri::AppHandle) {
    let handle = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || {
        if let Some(highlighter) = handle.get_webview_window("highlighter") {
            let _ = highlighter.set_size(tauri::Size::Logical(tauri::LogicalSize {
                width: rect.width,
                height: rect.height,
            }));
            let _ = highlighter.set_position(tauri::Position::Logical(tauri::LogicalPosition {
                x: rect.x,
                y: rect.y,
            }));
            let _ = highlighter.show();
        }
    });
}

/// 隐藏高亮发光描边窗口
#[tauri::command]
fn set_window_hover_exit(app_handle: tauri::AppHandle) {
    let handle = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || {
        if let Some(highlighter) = handle.get_webview_window("highlighter") {
            let _ = highlighter.hide();
        }
    });
}

/// 最小化主窗口
#[tauri::command]
fn minimize_window(app_handle: tauri::AppHandle) {
    let handle = app_handle.clone();
    let _ = app_handle.run_on_main_thread(move || {
        if let Some(main) = handle.get_webview_window("main") {
            let _ = main.minimize();
        }
    });
}

/// 关闭主窗口并退出程序，彻底消灭隐藏后台窗口残留进程
#[tauri::command]
fn close_window(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

/// 切换置顶主窗口
#[tauri::command]
fn toggle_window_pin(app_handle: tauri::AppHandle) -> PinResult {
    if let Some(main) = app_handle.get_webview_window("main") {
        let current_pinned = main.is_always_on_top().unwrap_or(false);
        let next_pinned = !current_pinned;
        let _ = main.set_always_on_top(next_pinned);
        PinResult {
            success: true,
            pinned: next_pinned,
        }
    } else {
        PinResult {
            success: false,
            pinned: false,
        }
    }
}

// --------------- App 注册入口 ---------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 注册全局崩溃 Panic 捕获弹窗，防止静默闪退并输出精确的行号和位置
    std::panic::set_hook(Box::new(|info| {
        let msg = format!("AutoButton 发生崩溃 Panic!\n\n信息: {}\n\n位置: {:?}", info, info.location());
        unsafe {
            use windows::core::PCWSTR;
            use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
            
            let title: Vec<u16> = "AutoButton Crash Handler\0".encode_utf16().collect();
            let message: Vec<u16> = format!("{}\0", msg).encode_utf16().collect();
            
            let _ = MessageBoxW(
                None,
                PCWSTR(message.as_ptr()),
                PCWSTR(title.as_ptr()),
                MB_ICONERROR | MB_OK,
            );
        }
    }));

    tauri::Builder::default()
        .manage(AppState {
            scheduler: Mutex::new(Scheduler { handles: Vec::new() }),
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // 动态实例化内联发光描边描边窗口，并利用初始化脚本注入标签
            let highlighter = tauri::WebviewWindowBuilder::new(
                app,
                "highlighter",
                tauri::WebviewUrl::App("index.html".into())
            )
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .initialization_script("window.__custom_window_label__ = 'highlighter';")
            .build()?;

            // 设置描边窗口点击穿透
            let _ = highlighter.set_ignore_cursor_events(true);

            // 在 setup 阶段获取所有可用屏幕，并为每一个屏幕静默初始化对应的预加载常驻选区窗口
            let mut available_monitors = Vec::new();
            if let Ok(monitors) = app.handle().available_monitors() {
                available_monitors = monitors;
            }
            if available_monitors.is_empty() {
                if let Ok(Some(monitor)) = app.handle().primary_monitor() {
                    available_monitors.push(monitor);
                }
            }

            for (i, monitor) in available_monitors.iter().enumerate() {
                let scale_factor = monitor.scale_factor();
                let monitor_size = monitor.size();
                let width = monitor_size.width as f64 / scale_factor;
                let height = monitor_size.height as f64 / scale_factor;
                let pos = monitor.position(); // 物理像素坐标
                let px_logical = pos.x as f64 / scale_factor;
                let py_logical = pos.y as f64 / scale_factor;

                let label = format!("overlay_{}", i);
                let _overlay = tauri::WebviewWindowBuilder::new(
                    app,
                    &label,
                    tauri::WebviewUrl::App("index.html".into())
                )
                .transparent(true)
                .decorations(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .position(px_logical, py_logical)
                .inner_size(width, height)
                .visible(false)
                .initialization_script(&format!(
                    "window.__custom_window_label__ = 'overlay'; window.__custom_window_physical_x__ = {}; window.__custom_window_physical_y__ = {}; window.__custom_window_scale_factor__ = {}; window.__custom_window_logical_x__ = {};",
                    pos.x, pos.y, scale_factor, px_logical
                ))
                .build()?;
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    window.app_handle().exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            verify_license,
            start_task,
            stop_task,
            get_window_list,
            capture_rect,
            open_overlay,
            show_overlay,
            selected_rect,
            set_window_hover,
            set_window_hover_exit,
            minimize_window,
            close_window,
            toggle_window_pin,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
