use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;

/// 使用系统自带的 WinRT OcrEngine 识别图像中的数字
pub fn recognize_number_from_pixels(pixels: &[u8], width: i32, height: i32) -> Option<i32> {
    if pixels.is_empty() || width <= 0 || height <= 0 {
        return None;
    }

    // 执行 WinRT 系统调用，确保在 COM 线程中正常运作
    let result = (|| -> windows::core::Result<Option<i32>> {
        // 1. 创建 OcrEngine 实例
        // 默认使用用户的系统首选语言列表创建引擎
        let engine = OcrEngine::TryCreateFromUserProfileLanguages()?;
        
        // 2. 将 RGBA 原始像素写入 WinRT IBuffer 缓冲区
        let writer = DataWriter::new()?;
        writer.WriteBytes(pixels)?;
        let buffer = writer.DetachBuffer()?;

        // 3. 创建空 SoftwareBitmap (指定 Rgba8 像素格式)
        let software_bitmap = SoftwareBitmap::Create(
            BitmapPixelFormat::Rgba8,
            width,
            height,
        )?;

        // 4. 将 buffer 像素复制到软件位图中
        software_bitmap.CopyFromBuffer(&buffer)?;

        // 5. 调用原生 OCR 并同步等待识别结果
        let async_op = engine.RecognizeAsync(&software_bitmap)?;
        let ocr_result = async_op.get()?;

        // 6. 提取并合并所有行的文字
        let mut full_text = String::new();
        for line in ocr_result.Lines()? {
            let text = line.Text()?.to_string();
            full_text.push_str(&text);
            full_text.push(' ');
        }

        log::info!("[OCR Raw Text] Result: {:?}", full_text.trim());

        // 7. 用字符搜索提取出第一串连续数字
        let text_trimmed = full_text.trim();
        let mut num_str = String::new();
        for c in text_trimmed.chars() {
            if c.is_ascii_digit() {
                num_str.push(c);
            } else if !num_str.is_empty() {
                break;
            }
        }

        if !num_str.is_empty() {
            if let Ok(val) = num_str.parse::<i32>() {
                return Ok(Some(val));
            }
        }

        Ok(None)
    })();

    match result {
        Ok(opt) => opt,
        Err(e) => {
            log::error!("[OCR WinRT Error] Failed to recognize: {:?}", e);
            None
        }
    }
}
