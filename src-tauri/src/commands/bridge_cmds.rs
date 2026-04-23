use std::path::PathBuf;
use std::sync::Mutex;
use serde::Serialize;
use tauri::{Manager, State};

// ── State ───────────────────────────────────────────────

pub struct BridgeState {
    pub server_process: Mutex<Option<std::process::Child>>,
    pub daemon_process: Mutex<Option<std::process::Child>>,
}

impl Default for BridgeState {
    fn default() -> Self {
        Self {
            server_process: Mutex::new(None),
            daemon_process: Mutex::new(None),
        }
    }
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn accounts_dir() -> Result<PathBuf, String> {
    let home = home_dir().ok_or("Cannot determine home directory")?;
    let dir = home.join(".echomind-wechat").join("accounts");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

// ── Server commands ─────────────────────────────────────

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

#[tauri::command]
pub fn bridge_start_server(
    app: tauri::AppHandle,
    state: State<BridgeState>,
) -> Result<String, String> {
    let mut proc = state.server_process.lock().map_err(|e| e.to_string())?;

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

// ── QR Login commands ───────────────────────────────────

const ILINK_BASE_URL: &str = "https://ilinkai.weixin.qq.com";

#[derive(Serialize)]
pub struct QrLoginInfo {
    pub qrcode_id: String,
    pub qrcode_url: String,
}

#[tauri::command]
pub async fn bridge_qr_start() -> Result<QrLoginInfo, String> {
    let url = format!("{}/ilink/bot/get_bot_qrcode?bot_type=3", ILINK_BASE_URL);
    let resp: serde_json::Value = reqwest::get(&url)
        .await
        .map_err(|e| format!("请求失败: {}", e))?
        .json()
        .await
        .map_err(|e| format!("解析失败: {}", e))?;

    let ret = resp["ret"].as_i64().unwrap_or(-1);
    if ret != 0 {
        return Err(format!("获取二维码失败: ret={}", ret));
    }

    let qrcode_id = resp["qrcode"]
        .as_str()
        .ok_or("Missing qrcode field")?
        .to_string();
    let qrcode_url = resp["qrcode_img_content"]
        .as_str()
        .ok_or("Missing qrcode_img_content field")?
        .to_string();

    Ok(QrLoginInfo {
        qrcode_id,
        qrcode_url,
    })
}

#[derive(Serialize)]
pub struct QrPollResult {
    pub status: String, // "wait", "scaned", "confirmed", "expired"
    pub account_id: Option<String>,
}

#[tauri::command]
pub async fn bridge_qr_poll(qrcode_id: String) -> Result<QrPollResult, String> {
    let url = format!(
        "{}/ilink/bot/get_qrcode_status?qrcode={}",
        ILINK_BASE_URL, qrcode_id
    );

    let resp: serde_json::Value = reqwest::get(&url)
        .await
        .map_err(|e| format!("轮询失败: {}", e))?
        .json()
        .await
        .map_err(|e| format!("解析失败: {}", e))?;

    let status = resp["status"]
        .as_str()
        .unwrap_or("wait")
        .to_string();

    if status == "confirmed" {
        let bot_token = resp["bot_token"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let account_id = resp["ilink_bot_id"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let base_url = resp["baseurl"]
            .as_str()
            .unwrap_or(ILINK_BASE_URL)
            .to_string();
        let user_id = resp["ilink_user_id"]
            .as_str()
            .unwrap_or("")
            .to_string();

        // Save account file (same format as Node.js login.ts)
        let dir = accounts_dir()?;
        let safe_id = account_id
            .chars()
            .map(|c| if c.is_alphanumeric() || "_.@=-".contains(c) { c } else { '_' })
            .collect::<String>();
        let file_path = dir.join(format!("{}.json", safe_id));

        let account = serde_json::json!({
            "botToken": bot_token,
            "accountId": account_id,
            "baseUrl": base_url,
            "userId": user_id,
            "createdAt": chrono::Utc::now().to_rfc3339(),
        });

        std::fs::write(&file_path, serde_json::to_string_pretty(&account).unwrap())
            .map_err(|e| format!("保存账号失败: {}", e))?;

        return Ok(QrPollResult {
            status,
            account_id: Some(account_id),
        });
    }

    Ok(QrPollResult {
        status,
        account_id: None,
    })
}

// ── Account status ──────────────────────────────────────

#[tauri::command]
pub fn bridge_wechat_account() -> Result<serde_json::Value, String> {
    let dir = accounts_dir()?;

    let mut latest: Option<(PathBuf, std::time::SystemTime)> = None;
    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
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

// ── Daemon commands ─────────────────────────────────────

#[tauri::command]
pub fn bridge_start_daemon(
    state: State<BridgeState>,
) -> Result<String, String> {
    let mut proc = state.daemon_process.lock().map_err(|e| e.to_string())?;

    if let Some(ref mut child) = *proc {
        match child.try_wait() {
            Ok(None) => return Ok("Daemon already running".to_string()),
            _ => {}
        }
    }

    let project_dir = find_wechat_project()?;
    let node_entry = project_dir.join("dist").join("main.js");

    if !node_entry.exists() {
        return Err(format!(
            "echomind-wechat 未构建，找不到 {}。请先运行: cd echomind-wechat && npm install && npm run build",
            node_entry.display()
        ));
    }

    // Use piped stderr so we can read errors if daemon exits quickly
    let mut child = std::process::Command::new("node")
        .arg(&node_entry)
        .arg("daemon")
        .current_dir(&project_dir)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 daemon 失败: {}。请确认已安装 Node.js", e))?;

    // Give it a moment to see if it crashes immediately
    std::thread::sleep(std::time::Duration::from_millis(500));
    match child.try_wait() {
        Ok(Some(status)) => {
            // Process already exited — read stderr for the error
            let mut stderr_output = String::new();
            if let Some(mut stderr) = child.stderr.take() {
                use std::io::Read;
                let _ = stderr.read_to_string(&mut stderr_output);
            }
            Err(format!(
                "Daemon 启动后立即退出 (exit={})。错误: {}",
                status,
                if stderr_output.is_empty() { "无输出".to_string() } else { stderr_output.trim().to_string() }
            ))
        }
        Ok(None) => {
            // Still running — success
            *proc = Some(child);
            Ok("Daemon started".to_string())
        }
        Err(e) => Err(format!("检查 daemon 状态失败: {}", e)),
    }
}

#[tauri::command]
pub fn bridge_stop_daemon(state: State<BridgeState>) -> Result<String, String> {
    let mut proc = state.daemon_process.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut child) = *proc {
        let _ = child.kill();
        let _ = child.wait();
    }
    *proc = None;
    Ok("Daemon stopped".to_string())
}

#[tauri::command]
pub fn bridge_daemon_status(state: State<BridgeState>) -> Result<bool, String> {
    let mut proc = state.daemon_process.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut child) = *proc {
        match child.try_wait() {
            Ok(None) => return Ok(true), // still running
            _ => {
                *proc = None;
                return Ok(false);
            }
        }
    }
    Ok(false)
}

// ── Helpers ─────────────────────────────────────────────

fn find_wechat_project() -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("echomind-wechat"));
        candidates.push(cwd.join("../echomind-wechat"));
        // Tauri dev CWD is often src-tauri/
        candidates.push(cwd.join("../../echomind-wechat"));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("echomind-wechat"));
            candidates.push(dir.join("../echomind-wechat"));
        }
    }

    for candidate in &candidates {
        if candidate.join("package.json").exists() {
            return Ok(strip_unc_prefix(
                candidate
                    .canonicalize()
                    .unwrap_or_else(|_| candidate.clone()),
            ));
        }
    }

    let tried: Vec<String> = candidates.iter().map(|p| p.display().to_string()).collect();
    Err(format!("echomind-wechat 项目未找到。搜索路径:\n{}", tried.join("\n")))
}

/// Strip Windows extended-length path prefix (\\?\) which Node.js cannot handle.
fn strip_unc_prefix(path: PathBuf) -> PathBuf {
    let s = path.to_string_lossy();
    if s.starts_with(r"\\?\") {
        PathBuf::from(&s[4..])
    } else {
        path
    }
}

fn find_server_binary(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(cwd) = std::env::current_dir() {
        // CWD might be project root or src-tauri/
        for base in [cwd.clone(), cwd.join("src-tauri"), cwd.join("..")] {
            candidates.push(base.join("target/debug/echomind-server.exe"));
            candidates.push(base.join("target/debug/echomind-server"));
            candidates.push(base.join("target/release/echomind-server.exe"));
            candidates.push(base.join("target/release/echomind-server"));
        }
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

    Err("echomind-server 未找到。请先构建: cargo build -p echomind-server".to_string())
}
