use std::io::Cursor;
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, SRCCOPY,
};

/// 捕获屏幕特定区域的原始 RGBA 像素数组，并返回 (RGBA像素数据, 宽度, 高度)
pub fn capture_screen_rect_raw(x: i32, y: i32, width: i32, height: i32) -> Option<(Vec<u8>, i32, i32)> {
    if width <= 0 || height <= 0 {
        return None;
    }

    unsafe {
        // 1. 获取屏幕 DC (HWND 传入 None 代表主屏幕)
        let hdc_screen = GetDC(None);
        if hdc_screen.is_invalid() {
            return None;
        }

        // 2. 创建兼容的内存 DC
        let hdc_mem = CreateCompatibleDC(Some(hdc_screen));
        if hdc_mem.is_invalid() {
            let _ = ReleaseDC(None, hdc_screen);
            return None;
        }

        // 3. 创建兼容位图并选入内存 DC
        let hbmp = CreateCompatibleBitmap(hdc_screen, width, height);
        if hbmp.is_invalid() {
            let _ = DeleteDC(hdc_mem);
            let _ = ReleaseDC(None, hdc_screen);
            return None;
        }

        let old_obj = SelectObject(hdc_mem, hbmp.into());

        // 4. 执行 BitBlt 拷贝像素
        let blit_ok = BitBlt(hdc_mem, 0, 0, width, height, Some(hdc_screen), x, y, SRCCOPY).is_ok();
        if !blit_ok {
            SelectObject(hdc_mem, old_obj);
            let _ = DeleteObject(hbmp.into());
            let _ = DeleteDC(hdc_mem);
            let _ = ReleaseDC(None, hdc_screen);
            return None;
        }

        // 5. 准备 DIB 头部信息
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height, // 负高表示自顶向下，扫描顺序为正向
                biPlanes: 1,
                biBitCount: 32,
                biCompression: 0,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: Default::default(),
        };

        let mut pixels = vec![0u8; (width * height * 4) as usize];

        // 6. 提取像素字节
        let lines_copied = GetDIBits(
            hdc_screen,
            hbmp,
            0,
            height as u32,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        // 7. 回收 GDI 资源
        SelectObject(hdc_mem, old_obj);
        let _ = DeleteObject(hbmp.into());
        let _ = DeleteDC(hdc_mem);
        let _ = ReleaseDC(None, hdc_screen);

        if lines_copied == 0 {
            return None;
        }

        // 8. 转换 BGR 为 RGBA
        for chunk in pixels.chunks_exact_mut(4) {
            chunk.swap(0, 2);
        }

        Some((pixels, width, height))
    }
}

/// 捕获屏幕特定区域并压缩为 PNG 字节流 (用于前端图片渲染)
pub fn capture_screen_rect_png(x: i32, y: i32, width: i32, height: i32) -> Option<Vec<u8>> {
    let (pixels, w, h) = capture_screen_rect_raw(x, y, width, height)?;

    let mut png_bytes = Vec::new();
    {
        let cursor = Cursor::new(&mut png_bytes);
        let mut encoder = png::Encoder::new(cursor, w as u32, h as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        
        let mut writer = match encoder.write_header() {
            Ok(w) => w,
            Err(_) => return None,
        };
        
        if writer.write_image_data(&pixels).is_err() {
            return None;
        }
    }

    Some(png_bytes)
}
