use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;

struct OcrParseResult {
    raw_text: String,
    matched_str: String,
    value: i32,
    percent: i32,
    is_ratio: bool,
}

/// 从原始识别文本中提取比例值或单值
fn extract_from_raw_text(raw_text: &str) -> Option<OcrParseResult> {
    let cleaned: String = raw_text
        .chars()
        .filter(|c: &char| !c.is_whitespace())
        .collect();

    let chars_vec: Vec<char> = cleaned.chars().collect();

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
                    log::info!("[OCR Ratio Parsed] {} / {} = {}%", current, max, percent);
                    return Some(OcrParseResult {
                        raw_text: raw_text.to_string(),
                        matched_str,
                        value: percent,
                        percent,
                        is_ratio: true,
                    });
                }
            }
        }
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
            return Some(OcrParseResult {
                raw_text: raw_text.to_string(),
                matched_str: num_str,
                value: val,
                percent: 0,
                is_ratio: false,
            });
        }
    }

    None
}

/// 计算 OCR 解析结果的综合得分
fn calculate_ocr_score(result: &OcrParseResult, is_original: bool) -> i32 {
    let mut score = 0;

    // 1. 基础分
    if result.is_ratio {
        score += 100;
    } else {
        score += 50;
    }

    // 2. 汉字/中文惩罚 (排除中文作为背景带来的误认)
    let has_chinese = result.raw_text.chars().any(|c| c >= '\u{4e00}' && c <= '\u{9fa5}');
    if has_chinese {
        score -= 60;
    }

    // 3. 逻辑异常惩罚（比率百分比合理性）
    // 比率模式下，若百分比超出 100%（例如分子大于分母），判定为畸变截断结果
    if result.is_ratio && result.percent > 100 {
        score -= 40;
    }

    // 4. 原图偏向微调分
    if is_original {
        score += 5;
    }

    score
}

/// 针对 RGBA 原始像素进行反相处理 (255 - X)，Alpha 通道保持不变
fn invert_rgba_pixels(pixels: &[u8]) -> Vec<u8> {
    let mut inverted = pixels.to_vec();
    for chunk in inverted.chunks_exact_mut(4) {
        chunk[0] = 255 - chunk[0]; // R
        chunk[1] = 255 - chunk[1]; // G
        chunk[2] = 255 - chunk[2]; // B
    }
    inverted
}

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
        let engine = OcrEngine::TryCreateFromUserProfileLanguages()?;

        // 统一的 OCR 识别闭包
        let run_ocr_for_pixels = |target_pixels: &[u8]| -> windows::core::Result<String> {
            let writer = DataWriter::new()?;
            writer.WriteBytes(target_pixels)?;
            let buffer = writer.DetachBuffer()?;

            let software_bitmap = SoftwareBitmap::Create(
                BitmapPixelFormat::Rgba8,
                scaled_w,
                scaled_h,
            )?;

            software_bitmap.CopyFromBuffer(&buffer)?;

            let async_op = engine.RecognizeAsync(&software_bitmap)?;
            let ocr_result = async_op.get()?;

            let mut full_text = String::new();
            for line in ocr_result.Lines()? {
                let text = line.Text()?.to_string();
                full_text.push_str(&text);
                full_text.push(' ');
            }
            Ok(full_text.trim().to_string())
        };

        // 2. 识别原图
        let raw_text_orig = run_ocr_for_pixels(&scaled_pixels)?;
        log::info!("[OCR Raw Text - Original] {:?}", raw_text_orig);
        let parsed_orig = extract_from_raw_text(&raw_text_orig);

        // 3. 识别反相图
        let inverted_pixels = invert_rgba_pixels(&scaled_pixels);
        let raw_text_inv = run_ocr_for_pixels(&inverted_pixels)?;
        log::info!("[OCR Raw Text - Inverted] {:?}", raw_text_inv);
        let parsed_inv = extract_from_raw_text(&raw_text_inv);

        // 4. 计算两路得分并决策胜出者
        let score_orig = parsed_orig.as_ref().map(|r| calculate_ocr_score(r, true)).unwrap_or(-999);
        let score_inv = parsed_inv.as_ref().map(|r| calculate_ocr_score(r, false)).unwrap_or(-999);

        log::info!("[OCR Score Comparison] Original Score: {}, Inverted Score: {}", score_orig, score_inv);

        // 若两路都解析失败，返回 None
        if parsed_orig.is_none() && parsed_inv.is_none() {
            return Ok(None);
        }

        // 选择得分最高的一路采信
        if score_orig >= score_inv {
            if let Some(res) = parsed_orig {
                log::info!("[OCR Decision] Chose Original: {} (value: {}, score: {})", res.matched_str, res.value, score_orig);
                return Ok(Some((res.raw_text, res.matched_str, res.value)));
            }
        } else {
            if let Some(res) = parsed_inv {
                log::info!("[OCR Decision] Chose Inverted: {} (value: {}, score: {})", res.matched_str, res.value, score_inv);
                return Ok(Some((res.raw_text, res.matched_str, res.value)));
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
