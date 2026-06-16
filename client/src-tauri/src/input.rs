/// 将前端传来的按键名解析为对应的 Win32 虚拟按键值 (Virtual Key)
fn parse_virtual_key(key: &str) -> Option<u16> {
    let key_upper = key.to_uppercase();
    if key_upper.len() == 1 {
        let ch = key_upper.chars().next()?;
        if ch >= 'A' && ch <= 'Z' {
            return Some(ch as u16);
        }
        if ch >= '0' && ch <= '9' {
            return Some(ch as u16);
        }
    }

    // 常用功能键与特殊按键的匹配
    match key_upper.as_str() {
        "SPACE" => Some(0x20),
        "ENTER" => Some(0x0D),
        "ESCAPE" | "ESC" => Some(0x1B),
        "BACKSPACE" => Some(0x08),
        "TAB" => Some(0x09),
        "LEFT" => Some(0x25),
        "UP" => Some(0x26),
        "RIGHT" => Some(0x27),
        "DOWN" => Some(0x28),
        "F1" => Some(0x70),
        "F2" => Some(0x71),
        "F3" => Some(0x72),
        "F4" => Some(0x73),
        "F5" => Some(0x74),
        "F6" => Some(0x75),
        "F7" => Some(0x76),
        "F8" => Some(0x77),
        "F9" => Some(0x78),
        "F10" => Some(0x79),
        "F11" => Some(0x7A),
        "F12" => Some(0x7B),
        _ => None,
    }
}

/// 自定义严格对齐的 64 位 Windows INPUT 结构体，避开 windows crate 封装层的所有时空开销与对齐 Bug。
/// 结构体在 64 位系统下大小为 40 字节，以 8 字节对齐。
#[repr(C)]
#[derive(Copy, Clone)]
struct MyInput {
    r#type: u32,
    _padding: u32,
    // 联合体数据。64位下联合体最大大小为 32 字节。
    // 使用 [u64; 4] 可以直接将整个联合体字节清零并按 8 字节物理对齐。
    union_data: [u64; 4],
}

#[link(name = "user32")]
extern "system" {
    // 动态连接系统 User32.dll 的 SendInput
    fn SendInput(cInputs: u32, pInputs: *const MyInput, cbSize: i32) -> u32;
}

/// 模拟按下并弹起指定的物理按键
pub fn press_key(key_name: &str) -> bool {
    let Some(vk_code) = parse_virtual_key(key_name) else {
        log::error!("[Input] Unsupported key name: {}", key_name);
        return false;
    };

    unsafe {
        // 1. 发送按下 (Key Down)
        let mut input_down = MyInput {
            r#type: 1, // INPUT_KEYBOARD
            _padding: 0,
            union_data: [0u64; 4],
        };
        // KEYBDINPUT 前 8 字节: wVk (低 16 位) | wScan (中 16-32 位) | dwFlags = 0 (高 32-64 位)
        input_down.union_data[0] = vk_code as u64; 
        let sent_down = SendInput(1, &input_down, 40);

        // 2. 发送弹起 (Key Up)
        let mut input_up = MyInput {
            r#type: 1,
            _padding: 0,
            union_data: [0u64; 4],
        };
        // KEYBDINPUT 前 8 字节: wVk (低 16 位) | wScan (中 16-32 位) | dwFlags = KEYEVENTF_KEYUP (0x0002, 高 32-64 位)
        input_up.union_data[0] = (2u64 << 32) | (vk_code as u64);
        let sent_up = SendInput(1, &input_up, 40);

        sent_down == 1 && sent_up == 1
    }
}
