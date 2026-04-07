use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

pub struct BridgeState {
    pub server_process: Mutex<Option<std::process::Child>>,
}

impl Default for BridgeState {
    fn default() -> Self {
        Self {
            server_process: Mutex::new(None),
        }
    }
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/// Check if echomind-server is reachable on port 8765
#[tauri::command]
pub async fn bridge_server_status() -> Result<serde_json::Value, String> {
    match reqwest::get("http://127.0.0.1:8765/api/status").await {
        Ok(resp) if resp.status().is_success() => {
            let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
            Ok(serde_json::json!({
                "online": true,
                "thoughts": data["thoughts"],
                "archived": data["archived"],
                "conversations": data["conversations"],
            }))
        }
        _ => Ok(serde_json::json!({ "online": false })),
    }
}

/// Start the echomind-server process
#[tauri::command]
pub fn bridge_start_server(
    app: tauri::AppHandle,
    state: State<BridgeState>,
) -> Result<String, String> {
    let mut proc = state.server_process.lock().map_err(|e| e.to_string())?;

    // Check if already running
    if let Some(ref mut child) = *proc {
        match child.try_wait() {
            Ok(None) => return Ok("Server already running".to_string()),
            _ => {}
        }
    }

    let exe_path = find_server_binary(&app)?;

    let child = std::process::Command::new(&exe_path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start server: {}", e))?;

    *proc = Some(child);
    Ok("Server started".to_string())
}

/// Stop the echomind-server process
#[tauri::command]
pub fn bridge_stop_server(state: State<BridgeState>) -> Result<String, String> {
    let mut proc = state.server_process.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut child) = *proc {
        let _ = child.kill();
        let _ = child.wait();
    }
    *proc = None;
    Ok("Server stopped".to_string())
}

/// Check WeChat account status (reads account file)
#[tauri::command]
pub fn bridge_wechat_account() -> Result<serde_json::Value, String> {
    let home = home_dir().ok_or("Cannot determine home directory")?;
    let data_dir = home.join(".echomind-wechat").join("accounts");

    if !data_dir.exists() {
        return Ok(serde_json::json!({ "configured": false }));
    }

    let mut latest: Option<(PathBuf, std::time::SystemTime)> = None;
    let entries = std::fs::read_dir(&data_dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e == "json").unwrap_or(false) {
            if let Ok(meta) = entry.metadata() {
                if let Ok(modified) = meta.modified() {
                    if latest.as_ref().map(|(_, t)| modified > *t).unwrap_or(true) {
                        latest = Some((path, modified));
                    }
                }
            }
        }
    }

    match latest {
        Some((path, _)) => {
            let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let account: serde_json::Value =
                serde_json::from_str(&content).map_err(|e| e.to_string())?;
            Ok(serde_json::json!({
                "configured": true,
                "accountId": account["accountId"],
                "createdAt": account["createdAt"],
            }))
        }
        None => Ok(serde_json::json!({ "configured": false })),
    }
}

/// Get path to the wechat bridge project
#[tauri::command]
pub fn bridge_wechat_project_path() -> Result<String, String> {
    let candidates: Vec<PathBuf> = vec![
        std::env::current_dir()
            .ok()
            .map(|d| d.join("../echomind-wechat")),
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("echomind-wechat"))),
    ]
    .into_iter()
    .flatten()
    .collect();

    for candidate in candidates {
        if candidate.join("package.json").exists() {
            return Ok(candidate
                .canonicalize()
                .unwrap_or(candidate)
                .to_string_lossy()
                .to_string());
        }
    }

    Err("echomind-wechat project not found".to_string())
}

fn find_server_binary(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("target/debug/echomind-server.exe"));
        candidates.push(cwd.join("target/debug/echomind-server"));
        candidates.push(cwd.join("target/release/echomind-server.exe"));
        candidates.push(cwd.join("target/release/echomind-server"));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("echomind-server.exe"));
            candidates.push(dir.join("echomind-server"));
        }
    }

    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("echomind-server.exe"));
        candidates.push(res.join("echomind-server"));
    }

    for candidate in candidates {
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("echomind-server binary not found. Build it with: cargo build -p echomind-server".to_string())
}
