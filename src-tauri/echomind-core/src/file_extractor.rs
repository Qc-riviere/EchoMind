use std::fs;
use std::io::Read;
use std::path::Path;

const MAX_CHARS: usize = 50000;

fn truncate_text(s: &str, max_chars: usize) -> String {
    let char_count = s.chars().count();
    if char_count <= max_chars {
        s.to_string()
    } else {
        s.chars().take(max_chars).collect::<String>() + "...[内容过长，已截断]"
    }
}

pub fn is_text_file(ext: &str) -> bool {
    matches!(
        ext.to_lowercase().as_str(),
        "txt"
            | "md"
            | "json"
            | "xml"
            | "html"
            | "htm"
            | "csv"
            | "log"
            | "yaml"
            | "yml"
            | "toml"
            | "ini"
            | "cfg"
            | "conf"
            | "sh"
            | "bat"
            | "ps1"
            | "py"
            | "js"
            | "ts"
            | "rs"
            | "c"
            | "cpp"
            | "h"
            | "css"
            | "sql"
    )
}

pub fn is_pdf_file(ext: &str) -> bool {
    ext.to_lowercase() == "pdf"
}

pub fn is_docx_file(ext: &str) -> bool {
    ext.to_lowercase() == "docx"
}

pub fn is_doc_file(ext: &str) -> bool {
    ext.to_lowercase() == "doc"
}

pub fn is_image_file(ext: &str) -> bool {
    matches!(
        ext.to_lowercase().as_str(),
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "svg"
    )
}

pub fn can_extract_text(ext: &str) -> bool {
    is_text_file(ext) || is_pdf_file(ext) || is_docx_file(ext)
}

pub fn extract_text_from_file(path: &Path) -> Result<String, String> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

    if is_text_file(ext) {
        extract_text_from_text_file(path)
    } else if is_pdf_file(ext) {
        extract_text_from_pdf(path)
    } else if is_docx_file(ext) {
        extract_text_from_docx(path)
    } else {
        Err(format!("Unsupported file type: .{}", ext))
    }
}

fn extract_text_from_text_file(path: &Path) -> Result<String, String> {
    let content = fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))?;

    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err("File is empty".to_string());
    }

    let truncated = truncate_text(trimmed, MAX_CHARS);
    Ok(truncated)
}

fn extract_text_from_pdf(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("Failed to read PDF file: {}", e))?;

    let text = pdf_extract::extract_text_from_mem(&bytes)
        .map_err(|e| format!("Failed to extract PDF text: {}", e))?;

    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("PDF contains no extractable text (may be scanned/image-based)".to_string());
    }

    let truncated = truncate_text(trimmed, MAX_CHARS);
    Ok(truncated)
}

fn extract_text_from_docx(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| format!("Failed to open DOCX file: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Failed to read DOCX as ZIP: {}", e))?;

    let mut text = String::new();

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to access file in DOCX: {}", e))?;
        let name = file.name().to_string();

        if name == "word/document.xml" {
            let mut content = String::new();
            file.read_to_string(&mut content)
                .map_err(|e| format!("Failed to read document.xml: {}", e))?;

            text = extract_text_from_xml(&content);
            break;
        }
    }

    if text.trim().is_empty() {
        return Err("DOCX contains no extractable text".to_string());
    }

    let trimmed = text.trim();
    let truncated = truncate_text(trimmed, MAX_CHARS);
    Ok(truncated)
}

fn extract_text_from_xml(xml: &str) -> String {
    let mut result = String::new();
    let mut in_text = false;
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(quick_xml::events::Event::Start(ref e))
            | Ok(quick_xml::events::Event::Empty(ref e)) => {
                if e.name().as_ref() == b"w:t" {
                    in_text = true;
                }
            }
            Ok(quick_xml::events::Event::End(ref e)) => {
                if e.name().as_ref() == b"w:t" {
                    in_text = false;
                }
            }
            Ok(quick_xml::events::Event::Text(ref e)) => {
                if in_text {
                    if let Ok(text) = e.unescape() {
                        result.push_str(&text);
                    }
                }
            }
            Ok(quick_xml::events::Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    result
}

pub fn get_file_description(path: &Path) -> Result<String, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");

    if is_image_file(&ext) {
        Ok(format!("[图片文件: {}]", filename))
    } else if is_text_file(&ext) {
        extract_text_from_file(path).map(|content| format!("[文本文件: {}]\n{}", filename, content))
    } else if is_pdf_file(&ext) {
        extract_text_from_file(path).map(|content| format!("[PDF文件: {}]\n{}", filename, content))
    } else if is_docx_file(&ext) {
        extract_text_from_file(path).map(|content| format!("[Word文档: {}]\n{}", filename, content))
    } else if is_doc_file(&ext) {
        Ok(format!(
            "[Word文档(.doc): {} - 需转换为.docx格式才能提取内容]",
            filename
        ))
    } else {
        let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        Ok(format!(
            "[文件: {} ({}字节)]",
            filename,
            format_file_size(size)
        ))
    }
}

fn format_file_size(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}
