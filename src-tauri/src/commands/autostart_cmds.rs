//! Launch-at-startup commands.
//!
//! On Windows we manage the `HKCU\…\Run` entry ourselves instead of going
//! through `tauri-plugin-autostart`: the underlying `auto-launch` crate writes
//! the value as `format!("{} {}", exe_path, args)` WITHOUT quoting the exe path
//! (auto-launch-0.5.0 src/windows.rs:42). For any path containing spaces — the
//! dev tree `D:\File VS code\…` and the production `C:\Program Files\EchoMind\…`
//! alike — that yields an unquoted Run command Windows can't parse, so the app
//! silently fails to start at boot. We write a properly-quoted entry instead.
//!
//! On non-Windows we delegate to the plugin, whose macOS/Linux paths are fine.

const AUTOSTART_KEY: &str = "EchoMind";
#[cfg(windows)]
const RUN_SUBKEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

/// The Run-key value we want: a quoted exe path plus the `--minimized` flag the
/// setup hook looks for to start tray-only.
#[cfg(windows)]
fn run_command() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(format!("\"{}\" --minimized", exe.display()))
}

/// Called once at startup. If autostart is currently enabled, rewrite the Run
/// entry with a correctly-quoted, up-to-date exe path — this self-heals the
/// broken unquoted entries written by older builds (and entries left pointing
/// at a stale path after an update). No-op when autostart is off.
#[cfg(windows)]
pub fn resync_windows_entry() {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};
    use winreg::RegKey;
    let Ok(run) = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(RUN_SUBKEY, KEY_READ | KEY_SET_VALUE)
    else {
        return;
    };
    let Ok(current) = run.get_value::<String, _>(AUTOSTART_KEY) else {
        return; // not enabled — nothing to fix
    };
    // Dev builds: an autostart entry pointing at the debug exe can never run
    // standalone (it loads the frontend from the Vite dev server), so it just
    // pops a broken window on boot. Remove that footgun; never touch a release
    // entry (whose path won't contain target\debug).
    if cfg!(debug_assertions) {
        if current.contains(r"target\debug") {
            let _ = run.delete_value(AUTOSTART_KEY);
        }
        return;
    }
    if let Ok(cmd) = run_command() {
        let _ = run.set_value(AUTOSTART_KEY, &cmd);
    }
}

#[tauri::command]
pub fn autostart_is_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(windows)]
    {
        let _ = app;
        use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
        use winreg::RegKey;
        let run = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(RUN_SUBKEY, KEY_READ)
            .map_err(|e| e.to_string())?;
        Ok(run.get_value::<String, _>(AUTOSTART_KEY).is_ok())
    }
    #[cfg(not(windows))]
    {
        use tauri_plugin_autostart::ManagerExt;
        app.autolaunch().is_enabled().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn autostart_set_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = app;
        use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
        use winreg::RegKey;
        let run = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(RUN_SUBKEY, KEY_SET_VALUE)
            .map_err(|e| e.to_string())?;
        if enabled {
            // A dev build's autostart would point at target\debug\echomind.exe,
            // which can't run standalone (needs the Vite dev server) — refuse it
            // instead of writing a Run entry that just breaks on boot.
            if cfg!(debug_assertions) {
                return Err(
                    "开机自启仅在正式安装版可用：开发版的自启会指向调试用的 echomind.exe（依赖本地开发服务器，开机无法独立运行）。请用安装包版本开启。"
                        .into(),
                );
            }
            run.set_value(AUTOSTART_KEY, &run_command()?)
                .map_err(|e| e.to_string())?;
        } else {
            // delete_value errors if the value is already absent — treat that as success.
            let _ = run.delete_value(AUTOSTART_KEY);
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        use tauri_plugin_autostart::ManagerExt;
        let mgr = app.autolaunch();
        if enabled {
            mgr.enable().map_err(|e| e.to_string())
        } else {
            mgr.disable().map_err(|e| e.to_string())
        }
    }
}
