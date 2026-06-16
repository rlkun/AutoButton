use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetForegroundWindow, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId,
    IsWindowVisible, GetWindowLongW, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
};

/// 导出的窗口信息，对齐前端类型
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WindowInfo {
    pub pid: u32,
    pub title: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// 获取当前处于前台焦点的窗口 PID 和标题
pub fn get_active_window() -> Option<(u32, String)> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return None;
        }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));

        // 获取窗口标题
        let mut buffer = [0u16; 512];
        let len = GetWindowTextW(hwnd, &mut buffer);
        if len == 0 {
            return Some((pid, String::new()));
        }

        let title = String::from_utf16_lossy(&buffer[..len as usize]);
        Some((pid, title.trim().to_string()))
    }
}

/// 枚举所有包含有效标题的系统可见窗口
pub fn get_system_windows() -> Vec<WindowInfo> {
    let mut list: Vec<WindowInfo> = Vec::new();
    let ptr = &mut list as *mut Vec<WindowInfo> as isize;

    unsafe {
        let _ = EnumWindows(Some(enum_windows_callback), LPARAM(ptr));
    }

    // 排序并去除重复的空项
    list.retain(|w| !w.title.is_empty() && w.x != -32000); // 排除最小化到托盘/隐藏状态的 -32000 窗口
    list.sort_by(|a, b| a.title.localeCompare(&b.title));
    list
}

/// 过滤出有意义的窗口：可见、非ToolWindow、有标题
unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    if !IsWindowVisible(hwnd).as_bool() {
        return BOOL(1); // 继续枚举
    }

    // 获取扩展样式，过滤 Tool 窗口
    let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
    if (ex_style & WS_EX_TOOLWINDOW.0) != 0 {
        return BOOL(1);
    }

    let mut buffer = [0u16; 512];
    let len = GetWindowTextW(hwnd, &mut buffer);
    if len == 0 {
        return BOOL(1);
    }
    let title = String::from_utf16_lossy(&buffer[..len as usize]).trim().to_string();
    if title.is_empty() {
        return BOOL(1);
    }

    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));

    let mut rect = RECT::default();
    let mut x = 0;
    let mut y = 0;
    let mut w = 0;
    let mut h = 0;
    if GetWindowRect(hwnd, &mut rect).is_ok() {
        x = rect.left;
        y = rect.top;
        w = rect.right - rect.left;
        h = rect.bottom - rect.top;
    }

    // 忽略异常或无效的窗口尺寸
    if w <= 0 || h <= 0 {
        return BOOL(1);
    }

    let list = &mut *(lparam.0 as *mut Vec<WindowInfo>);
    list.push(WindowInfo {
        pid,
        title,
        x,
        y,
        width: w,
        height: h,
    });

    BOOL(1) // 继续枚举
}

// 辅助排序 trait，实现与 JS 一致的本地字符串比较
#[allow(non_snake_case)]
trait LocaleCompare {
    fn localeCompare(&self, other: &Self) -> std::cmp::Ordering;
}

#[allow(non_snake_case)]
impl LocaleCompare for String {
    fn localeCompare(&self, other: &Self) -> std::cmp::Ordering {
        self.to_lowercase().cmp(&other.to_lowercase())
    }
}
