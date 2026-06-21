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

        let text_trimmed = full_text.trim();
        log::info!("[OCR Raw Text] Result: {:?}", text_trimmed);

        // 7. 提取数字与比例值 (兼容 "759/3418" 比例格式与 "80%" 单值格式)
        let cleaned: String = text_trimmed
            .chars()
            .filter(|c: &char| !c.is_whitespace())
            .collect();

        let chars_vec: Vec<char> = cleaned.chars().collect();
        let mut ratio_result: Option<i32> = None;

        // 尝试寻找比例分隔符 (如 '/', '\', '|')
        if let Some(slash_idx) = chars_vec.iter().position(|&c| c == '/' || c == '\\' || c == '|') {
            // 向左逆向收集数字字符
            let mut left_num_str = String::new();
            for &c in chars_vec[..slash_idx].iter().rev() {
                if c.is_ascii_digit() {
                    left_num_str.insert(0, c);
                } else {
                    break;
                }
            }

            // 向右收集数字字符
            let mut right_num_str = String::new();
            for &c in chars_vec[slash_idx + 1..].iter() {
                if c.is_ascii_digit() {
                    right_num_str.push(c);
                } else {
                    break;
                }
            }

            if !left_num_str.is_empty() && !right_num_str.is_empty() {
                if let (Ok(current), Ok(max)) = (left_num_str.parse::<i32>(), right_num_str.parse::<i32>()) {
                    if max > 0 {
                        let percent = (current as f64 / max as f64 * 100.0) as i32;
                        ratio_result = Some(percent);
                        log::info!("[OCR Ratio Parsed] {} / {} = {}%", current, max, percent);
                    }
                }
            }
        }

        if let Some(val) = ratio_result {
            return Ok(Some(val));
        }

        // 兜底退化逻辑：提取出第一串连续数字并直接作为结果返回 (适应 "80%", "80" 格式)
        let mut num_str = String::new();
        for c in cleaned.chars() {
            if c.is_ascii_digit() {
                num_str.push(c);
            } else if !num_str.is_empty() {
                break;
            }
        }

        if !num_str.is_empty() {
            if let Ok(val) = num_str.parse::<i32>() {
                log::info!("[OCR Single Parsed] Val: {}", val);
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
