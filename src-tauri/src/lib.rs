use tauri::{Manager, WindowEvent};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};

mod commands;

const CAPTURE_SHORTCUT: &str = "CmdOrCtrl+Shift+I";

fn show_capture_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("capture") {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.center();
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

fn refresh_tray_tooltip(app: &tauri::AppHandle) {
    let state: tauri::State<'_, AppCore> = app.state();
    let n = state.0.count_today_thoughts().unwrap_or(0);
    let label = if n == 0 {
        "EchoMind · 今日还没记".to_string()
    } else {
        format!("EchoMind · 今日新增 {n}")
    };
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(&label));
    }
}

pub struct AppCore(pub echomind_core::EchoMind);

/// Install default skill files if they don't already exist.
fn install_default_skills(skills_dir: &std::path::Path) {
    let defaults: &[(&str, &str)] = &[
        ("summarize.md", include_str!("../skills/summarize.md")),
        ("analyze.md", include_str!("../skills/analyze.md")),
        ("brainstorm.md", include_str!("../skills/brainstorm.md")),
        ("rewrite.md", include_str!("../skills/rewrite.md")),
        ("translate.md", include_str!("../skills/translate.md")),
    ];
    for (name, content) in defaults {
        let path = skills_dir.join(name);
        if !path.exists() {
            let _ = std::fs::write(&path, content);
        }
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin({
            use tauri_plugin_global_shortcut::{Builder as GsBuilder, ShortcutState};
            GsBuilder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        show_capture_window(app);
                    }
                })
                .build()
        })
        .on_window_event(|window, event| {
            if window.label() == "capture" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    // Hide instead of closing — keep the window alive for next hotkey trigger.
                    let _ = window.hide();
                    api.prevent_close();
                } else if let WindowEvent::Focused(false) = event {
                    let _ = window.hide();
                }
            } else if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    // Tray-resident app: X minimises to tray instead of quitting.
                    // Without this the tray icon vanishes alongside the window.
                    let _ = window.hide();
                    api.prevent_close();

                    let app = window.app_handle();
                    let state: tauri::State<'_, AppCore> = app.state();
                    let already_hinted = state
                        .0
                        .get_setting("tray_close_hint_shown")
                        .unwrap_or(None)
                        .is_some();
                    if !already_hinted {
                        use tauri_plugin_notification::NotificationExt;
                        let _ = app
                            .notification()
                            .builder()
                            .title("EchoMind 仍在后台运行")
                            .body("点关闭只是最小化到任务栏托盘。要彻底退出请右键托盘图标 →「退出 EchoMind」。")
                            .show();
                        let _ = state.0.set_setting("tray_close_hint_shown", "1");
                    }
                }
            }
        })
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to get app data dir");
            std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");

            let db_path = app_dir.join("echomind.db");
            let files_dir = app_dir.join("images");
            std::fs::create_dir_all(&files_dir).expect("failed to create images dir");

            let skills_dir = app_dir.join("skills");
            std::fs::create_dir_all(&skills_dir).expect("failed to create skills dir");
            install_default_skills(&skills_dir);

            let core = echomind_core::EchoMind::open_with_files_dir(&db_path, &files_dir)
                .expect("failed to initialize database");

            app.manage(AppCore(core));
            app.manage(commands::bridge_cmds::BridgeState::default());

            // Register the global capture shortcut. Failures are non-fatal — the
            // user can still capture from the main window.
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                if let Err(e) = app.global_shortcut().register(CAPTURE_SHORTCUT) {
                    eprintln!("[hotkey] failed to register {CAPTURE_SHORTCUT}: {e}");
                }
            }

            // System tray: left click → show main window; right click → menu
            // with explicit Show / Capture / Quit. Without the menu the only
            // way to quit a tray-resident build was to kill the process.
            let show_item = MenuItem::with_id(app, "tray_show", "显示主窗口", true, None::<&str>)?;
            let capture_item = MenuItem::with_id(
                app,
                "tray_capture",
                "速记浮窗 (Ctrl+Shift+I)",
                true,
                None::<&str>,
            )?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit_item =
                MenuItem::with_id(app, "tray_quit", "退出 EchoMind", true, None::<&str>)?;
            let tray_menu = Menu::with_items(
                app,
                &[&show_item, &capture_item, &separator, &quit_item],
            )?;

            let tray_handle = app.handle().clone();
            let menu_handle = app.handle().clone();
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().expect("missing icon").clone())
                .tooltip("EchoMind")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |_app, event| match event.id().as_ref() {
                    "tray_show" => show_main_window(&menu_handle),
                    "tray_capture" => show_capture_window(&menu_handle),
                    "tray_quit" => menu_handle.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(move |_tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(&tray_handle);
                    }
                })
                .build(app)?;

            refresh_tray_tooltip(&app.handle());

            // Periodic tray tooltip refresh — covers day-rollover and external
            // mutations (WeChat bridge sync, manual edits) without needing per-
            // command hooks.
            let tray_refresh_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                loop {
                    interval.tick().await;
                    refresh_tray_tooltip(&tray_refresh_handle);
                }
            });

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // 5s when healthy; auto-backs off to 5min on auth-expired so
                // a stale JWT doesn't flood logs with 12 errors/minute.
                const NORMAL_SECS: u64 = 5;
                const BACKOFF_SECS: u64 = 300;
                let mut current_secs = NORMAL_SECS;
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(current_secs));
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                let mut last_err: Option<String> = None;
                let mut backed_off = false;
                loop {
                    interval.tick().await;
                    let state: tauri::State<'_, AppCore> = app_handle.state();
                    match state.0.bridge_sync_pull().await {
                        Ok(n) => {
                            if backed_off {
                                eprintln!("[bridge-sync] recovered, resuming {NORMAL_SECS}s interval");
                                backed_off = false;
                                current_secs = NORMAL_SECS;
                                interval = tokio::time::interval(std::time::Duration::from_secs(current_secs));
                                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                            }
                            last_err = None;
                            if n > 0 {
                                use tauri_plugin_notification::NotificationExt;
                                let _ = app_handle
                                    .notification()
                                    .builder()
                                    .title("EchoMind")
                                    .body(format!("从云端同步到 {n} 条新灵感"))
                                    .show();
                                let _ = tauri::Emitter::emit(&app_handle, "bridge:synced", n);
                                refresh_tray_tooltip(&app_handle);
                            }
                        }
                        Err(e) => {
                            // Only print on transition (e.g. recovered → newly-failing,
                            // or error message changed). Avoids flooding the console.
                            let same_as_last = last_err.as_deref() == Some(e.as_str());
                            let is_auth_expired = e.contains("401")
                                && (e.contains("ExpiredSignature") || e.contains("invalid token"));
                            if !same_as_last {
                                eprintln!("[bridge-sync] {e}");
                                if is_auth_expired && !backed_off {
                                    eprintln!(
                                        "[bridge-sync] auth expired — backing off to {BACKOFF_SECS}s; \
                                         re-pair in 设置 → 云桥 to restore live sync"
                                    );
                                }
                                last_err = Some(e);
                            }
                            if is_auth_expired && !backed_off {
                                backed_off = true;
                                current_secs = BACKOFF_SECS;
                                interval = tokio::time::interval(std::time::Duration::from_secs(current_secs));
                                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                            }
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::thought_cmds::create_thought,
            commands::thought_cmds::list_thoughts,
            commands::thought_cmds::list_home_thoughts,
            commands::thought_cmds::set_pinned_thought,
            commands::thought_cmds::count_today_thoughts,
            commands::ai_cmds::summarize_thoughts,
            commands::thought_cmds::get_thought,
            commands::thought_cmds::update_thought,
            commands::thought_cmds::archive_thought,
            commands::thought_cmds::list_archived_thoughts,
            commands::thought_cmds::unarchive_thought,
            commands::thought_cmds::delete_thought,
            commands::thought_cmds::get_image_path,
            commands::thought_cmds::save_image,
            commands::thought_cmds::create_thought_with_image,
            commands::thought_cmds::open_file,
            commands::thought_cmds::read_file_content,
            commands::thought_cmds::get_embedding_graph,
            commands::thought_cmds::get_thought_neighbors,
            commands::thought_cmds::get_graph_node,
            commands::setting_cmds::get_setting,
            commands::setting_cmds::set_setting,
            commands::setting_cmds::delete_setting,
            commands::setting_cmds::get_all_settings,
            commands::ai_cmds::test_llm_connection,
            commands::ai_cmds::list_models,
            commands::ai_cmds::list_embedding_models,
            commands::ai_cmds::enrich_thought,
            commands::ai_cmds::embed_thought,
            commands::ai_cmds::semantic_search,
            commands::ai_cmds::find_related_thoughts,
            commands::ai_cmds::suggest_resources,
            commands::ai_cmds::reembed_all_thoughts,
            commands::chat_cmds::list_recent_conversations,
            commands::chat_cmds::get_conversations,
            commands::chat_cmds::start_chat,
            commands::chat_cmds::get_chat_messages,
            commands::chat_cmds::send_chat_message,
            commands::chat_cmds::withdraw_message,
            commands::chat_cmds::synthesize_chat_plan,
            commands::bridge_cmds::bridge_server_status,
            commands::bridge_cmds::bridge_start_server,
            commands::bridge_cmds::bridge_stop_server,
            commands::bridge_cmds::bridge_wechat_account,
            commands::bridge_cmds::bridge_qr_start,
            commands::bridge_cmds::bridge_qr_poll,
            commands::bridge_cmds::bridge_start_daemon,
            commands::bridge_cmds::bridge_stop_daemon,
            commands::bridge_cmds::bridge_daemon_status,
            commands::cloud_bridge_cmds::cloud_bridge_status,
            commands::cloud_bridge_cmds::cloud_bridge_pair,
            commands::cloud_bridge_cmds::cloud_bridge_set_enabled,
            commands::cloud_bridge_cmds::cloud_bridge_set_llm_via_bridge,
            commands::cloud_bridge_cmds::cloud_bridge_set_rules,
            commands::cloud_bridge_cmds::cloud_bridge_initial_sync,
            commands::cloud_bridge_cmds::cloud_bridge_sync_pull,
            commands::cloud_bridge_cmds::cloud_bridge_terminate,
            commands::cloud_bridge_cmds::cloud_bridge_push_llm_config,
            commands::cloud_bridge_cmds::cloud_bridge_clear_llm_config,
            commands::cloud_bridge_cmds::cloud_bridge_remote_llm_status,
            commands::skill_cmds::list_skills,
            commands::skill_cmds::execute_skill,
            commands::skill_cmds::get_skills_dir,
            commands::skill_cmds::save_skill,
            commands::skill_cmds::delete_skill,
            commands::skill_cmds::scan_external_skills,
            commands::skill_cmds::import_external_skill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
