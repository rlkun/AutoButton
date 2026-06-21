use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;

/// 使用 system 自带的 WinRT OcrEngine 识别图像中的数字
pub fn recognize_number_from_pixels(pixels: &[u8], width: i32, height: i32) -> Option<(String, String, i32)> {
    if pixels.is_empty() || width <= 0 || height <= 0 {
        return None;
    }

    // 若截图高度过小，则将图像放大 3 倍，解决 WinRT OCR 识别小图片经常丢失的问题
    let (scaled_pixels, scaled_w, scaled_h) = if height < 50 {
        resize_rgba_nearest(pixels, width, height, 3)
    } else {
        (pixels.to_vec(), width, height)
    };

    // 执行 WinRT 系统调用，确保在 COM 线程中正常运作
    let result = (|| -> windows::core::Result<Option<(String, String, i32)>> {
        // 1. 创建 OcrEngine 实例
        // 默认使用用户的系统首选语言列表创建引擎
        let engine = OcrEngine::TryCreateFromUserProfileLanguages()?;
        
        // 2. 将 RGBA 原始像素写入 WinRT IBuffer 缓冲区
        let writer = DataWriter::new()?;
        writer.WriteBytes(&scaled_pixels)?;
        let buffer = writer.DetachBuffer()?;

        // 3. 创建空 SoftwareBitmap (指定 Rgba8 像素格式)
        let software_bitmap = SoftwareBitmap::Create(
            BitmapPixelFormat::Rgba8,
            scaled_w,
            scaled_h,
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
        let mut ratio_result: Option<(String, i32)> = None;

        // 尝试寻找比例分隔符 (如 '/', '\', '|')
        if let Some(slash_idx) = chars_vec.iter().position(|&c| c == '/' || c == '\\' || c == '|') {
            // 向左逆向收集数字字符 (兼容千分位逗号、点号、单引号、中文逗号、中点及句号误识别)
            let mut left_num_str = String::new();
            for &c in chars_vec[..slash_idx].iter().rev() {
                if c.is_ascii_digit() || c == ',' || c == '.' || c == '\'' || c == '，' || c == '·' || c == '。' {
                    left_num_str.insert(0, c);
                } else {
                    break;
                }
            }

            // 向右收集数字字符 (兼容千分位逗号、点号、单引号、中文逗号、中点及句号误识别)
            let mut right_num_str = String::new();
            for &c in chars_vec[slash_idx + 1..].iter() {
                if c.is_ascii_digit() || c == ',' || c == '.' || c == '\'' || c == '，' || c == '·' || c == '。' {
                    right_num_str.push(c);
                } else {
                    break;
                }
            }

            if !left_num_str.is_empty() && !right_num_str.is_empty() {
                // 清洗非数字字符
                let left_clean: String = left_num_str.chars().filter(|c| c.is_ascii_digit()).collect();
                let right_clean: String = right_num_str.chars().filter(|c| c.is_ascii_digit()).collect();

                if let (Ok(current), Ok(max)) = (left_clean.parse::<i32>(), right_clean.parse::<i32>()) {
                    if max > 0 {
                        let percent = (current as f64 / max as f64 * 100.0) as i32;
                        let matched_str = format!("{}/{}", left_num_str, right_num_str);
                        ratio_result = Some((matched_str, percent));
                        log::info!("[OCR Ratio Parsed] {} / {} = {}%", current, max, percent);
                    }
                }
            }
        }

        if let Some(res) = ratio_result {
            return Ok(Some((text_trimmed.to_string(), res.0, res.1)));
        }

        // 兜底退化逻辑：提取出第一串连续数字并直接作为结果返回 (适应 "80%", "80" 格式，兼容千分位及符号误识别)
        let mut num_str = String::new();
        for c in cleaned.chars() {
            if c.is_ascii_digit() || c == ',' || c == '.' || c == '\'' || c == '，' || c == '·' || c == '。' {
                num_str.push(c);
            } else if !num_str.is_empty() {
                break;
            }
        }

        if !num_str.is_empty() {
            let num_clean: String = num_str.chars().filter(|c| c.is_ascii_digit()).collect();
            if let Ok(val) = num_clean.parse::<i32>() {
                log::info!("[OCR Single Parsed] Val: {}", val);
                return Ok(Some((text_trimmed.to_string(), num_str, val)));
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

/// 针对 RGBA 原始像素的最邻近插值缩放辅助函数 (Nearest-Neighbor Interpolation)
fn resize_rgba_nearest(pixels: &[u8], width: i32, height: i32, factor: i32) -> (Vec<u8>, i32, i32) {
    if factor <= 1 {
        return (pixels.to_vec(), width, height);
    }

    let new_width = width * factor;
    let new_height = height * factor;
    let mut new_pixels = vec![0u8; (new_width * new_height * 4) as usize];

    for dy in 0..new_height {
        let sy = dy / factor;
        let sy = if sy >= height { height - 1 } else { sy };
        let src_row_start = (sy * width * 4) as usize;
        let dest_row_start = (dy * new_width * 4) as usize;

        for dx in 0..new_width {
            let sx = dx / factor;
            let sx = if sx >= width { width - 1 } else { sx };

            let src_idx = src_row_start + (sx * 4) as usize;
            let dest_idx = dest_row_start + (dx * 4) as usize;

            new_pixels[dest_idx..dest_idx + 4].copy_from_slice(&pixels[src_idx..src_idx + 4]);
        }
    }

    (new_pixels, new_width, new_height)
}
