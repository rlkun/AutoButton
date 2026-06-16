/**
 * 统一 IPC 通信适配层
 * 智能检测运行环境（Electron / Tauri / Web），自动桥接底层调用。
 * 前端 React 组件仅依赖本文件导出的接口，与具体平台完全解耦。
 */

// --------------- 环境检测 ---------------

/** 当前是否运行在 Electron 环境中 */
export const isElectron = (): boolean =>
  typeof window !== 'undefined' && !!(window as any).electronAPI;

/** 当前是否运行在 Tauri 环境中 */
export const isTauri = (): boolean =>
  typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;

/** 获取当前窗口的 Label，用于路由自检 */
export async function getWindowLabel(): Promise<string | null> {
  const syncLabel = getWindowLabelSync();
  if (syncLabel) return syncLabel;

  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      return win.label || 'main';
    } catch (e) {
      console.error("Failed to get Tauri window label asynchronously", e);
      return 'main';
    }
  }
  return null;
}

/** 同步获取当前窗口的 Label，用于 React 初始化时首帧确定路由，防止 DOM 重绘闪烁与加载失败 */
export function getWindowLabelSync(): string | null {
  if (typeof window === 'undefined') return null;

  // 1. 优先读取 Rust 初始化脚本注入的全局自定义 label（最稳定、无模块依赖）
  if ((window as any).__custom_window_label__) {
    return (window as any).__custom_window_label__;
  }

  // 2. 如果是 Electron 环境，主要还是看 window.location.hash
  if (!!(window as any).electronAPI) {
    return window.location.hash === '#/overlay' ? 'overlay' : 'main';
  }

  // 3. 如果处于 Tauri 环境下且不存在上述特殊注入标签，说明一定是默认主窗口 "main"
  if (!!(window as any).__TAURI_INTERNALS__) {
    return 'main';
  }

  // 4. 兜底返回 null，等待异步 useEffect 进行二次自检
  return null;
}


// --------------- Electron 快捷引用 ---------------

const electronAPI = (): any => (window as any).electronAPI;

// --------------- Tauri invoke 动态加载 ---------------

let _tauriInvoke: ((cmd: string, args?: Record<string, unknown>) => Promise<any>) | null = null;
let _tauriListen: ((event: string, handler: (payload: any) => void) => Promise<() => void>) | null = null;

async function getTauriInvoke() {
  if (!_tauriInvoke) {
    const { invoke } = await import('@tauri-apps/api/core');
    _tauriInvoke = invoke;
  }
  return _tauriInvoke;
}

async function getTauriListen() {
  if (!_tauriListen) {
    const { listen } = await import('@tauri-apps/api/event');
    _tauriListen = listen;
  }
  return _tauriListen;
}

// --------------- 公共 IPC API ---------------

/** 验证 License（当前 Fallback 直接放行） */
export async function verifyLicense(): Promise<{ success: boolean; message: string }> {
  if (isElectron()) {
    return electronAPI().verifyLicense();
  }
  if (isTauri()) {
    const invoke = await getTauriInvoke();
    return invoke('verify_license');
  }
  // Web fallback
  return { success: true, message: 'Fallback valid' };
}

/** 启动任务调度 */
export async function startTask(config: {
  tasks: any[];
  globalEnabled: boolean;
  targetWindow: any;
}): Promise<{ success: boolean }> {
  if (isElectron()) {
    return electronAPI().startTask(config);
  }
  if (isTauri()) {
    const invoke = await getTauriInvoke();
    return invoke('start_task', { config });
  }
  return { success: false };
}

/** 停止所有任务 */
export async function stopTask(): Promise<{ success: boolean }> {
  if (isElectron()) {
    return electronAPI().stopTask();
  }
  if (isTauri()) {
    const invoke = await getTauriInvoke();
    return invoke('stop_task');
  }
  return { success: true };
}

/** 打开全屏 Overlay 用于框选识别范围 */
export async function openOverlay(): Promise<void> {
  if (isElectron()) {
    return electronAPI().openOverlay();
  }
  if (isTauri()) {
    const invoke = await getTauriInvoke();
    return invoke('open_overlay');
  }
}

/** 显示 Overlay 窗口 */
export async function showOverlay(): Promise<void> {
  if (isElectron()) {
    return;
  }
  if (isTauri()) {
    const invoke = await getTauriInvoke();
    return invoke('show_overlay');
  }
}

/** 获取系统活跃窗口列表 */
export async function getWindowList(): Promise<any[]> {
  if (isElectron()) {
    return electronAPI().getWindowList();
  }
  if (isTauri()) {
    const invoke = await getTauriInvoke();
    return invoke('get_window_list');
  }
  return [];
}

/** 截屏指定区域，返回 DataURL */
export async function captureRect(rect: any): Promise<string | null> {
  if (isElectron()) {
    return electronAPI().captureRect(rect);
  }
  if (isTauri()) {
    const invoke = await getTauriInvoke();
    return invoke('capture_rect', { rect });
  }
  return null;
}

/** 最小化窗口 */
export async function minimizeWindow(): Promise<void> {
  if (isElectron()) {
    electronAPI().minimize();
  }
  if (isTauri()) {
    const invoke = await getTauriInvoke();
    return invoke('minimize_window');
  }
}

/** 切换置顶窗口 */
export async function toggleWindowPin(): Promise<{ success: boolean; pinned: boolean }> {
  if (isElectron()) {
    return electronAPI().pin();
  }
  if (isTauri()) {
    const invoke = await getTauriInvoke();
    return invoke('toggle_window_pin');
  }
  return { success: false, pinned: false };
}

/** 关闭窗口 */
export async function closeWindow(): Promise<void> {
  if (isElectron()) {
    electronAPI().close();
  }
  if (isTauri()) {
    const invoke = await getTauriInvoke();
    return invoke('close_window');
  }
}

/** 发送 Overlay 框选结果到主进程 */
export async function sendSelectedRect(rect: any): Promise<void> {
  if (isElectron()) {
    electronAPI().sendSelectedRect(rect);
  }
  if (isTauri()) {
    const invoke = await getTauriInvoke();
    return invoke('selected_rect', { rect });
  }
}

/** 发送窗口高亮框 Hover 事件（用于目标窗口高亮描边） */
export async function setWindowHover(rect: any): Promise<void> {
  if (isElectron()) {
    electronAPI().windowHover?.(rect);
  }
  if (isTauri()) {
    const invoke = await getTauriInvoke();
    return invoke('set_window_hover', { rect });
  }
}

/** 发送窗口高亮框退出事件 */
export async function setWindowHoverExit(): Promise<void> {
  if (isElectron()) {
    electronAPI().windowHoverExit?.();
  }
  if (isTauri()) {
    const invoke = await getTauriInvoke();
    return invoke('set_window_hover_exit');
  }
}

// --------------- 事件监听（Push 型回调） ---------------

/**
 * 订阅任务日志/状态推送
 * @returns 取消订阅的 cleanup 函数
 */
export function onTaskUpdate(callback: (data: any) => void): () => void {
  if (isElectron()) {
    return electronAPI().onTaskUpdate(callback);
  }
  if (isTauri()) {
    let unlisten: (() => void) | null = null;
    getTauriListen().then(listen => {
      listen('task-update', (event: any) => callback(event.payload)).then(fn => {
        unlisten = fn;
      });
    });
    return () => { unlisten?.(); };
  }
  return () => {};
}

/**
 * 订阅 Overlay 框选完成事件
 * @returns 取消订阅的 cleanup 函数
 */
export function onOverlaySelected(callback: (rect: any) => void): () => void {
  if (isElectron()) {
    return electronAPI().onOverlaySelected(callback);
  }
  if (isTauri()) {
    let unlisten: (() => void) | null = null;
    getTauriListen().then(listen => {
      listen('overlay-selected', (event: any) => callback(event.payload)).then(fn => {
        unlisten = fn;
      });
    });
    return () => { unlisten?.(); };
  }
  return () => {};
}
