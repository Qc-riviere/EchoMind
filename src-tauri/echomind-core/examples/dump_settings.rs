// Quick diagnostic: dump all llm_* / embedding_* settings from the live DB.
//
//   cargo run --example dump_settings -p echomind-core
//
// Tries default Tauri appdata path on Windows; override with EM_DB env var.

use std::env;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db_path: PathBuf = if let Ok(p) = env::var("EM_DB") {
        PathBuf::from(p)
    } else if let Ok(appdata) = env::var("APPDATA") {
        PathBuf::from(appdata).join("com.fu-qianchen.echomind").join("echomind.db")
    } else {
        return Err("Set EM_DB env var to your echomind.db path".into());
    };

    println!("=== Reading: {} ===\n", db_path.display());

    if !db_path.exists() {
        return Err(format!("DB not found at {}", db_path.display()).into());
    }

    let conn = rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;

    let mut stmt = conn.prepare(
        "SELECT key, value FROM settings
         WHERE key LIKE 'llm_%' OR key LIKE 'embedding_%' OR key LIKE 'bridge_%'
         ORDER BY key",
    )?;
    let mut rows = stmt.query([])?;

    while let Some(row) = rows.next()? {
        let key: String = row.get(0)?;
        let value: String = row.get(1)?;
        let display_value = if key.contains("api_key") || key.contains("token") {
            if value.is_empty() {
                "<empty>".to_string()
            } else if value.len() > 12 {
                format!("{}...{} (len={})",
                    &value[..6], &value[value.len() - 4..], value.len())
            } else {
                format!("<{} chars>", value.len())
            }
        } else if value.is_empty() {
            "<empty>".to_string()
        } else {
            value
        };
        println!("  {:36} = {}", key, display_value);
    }

    Ok(())
}
