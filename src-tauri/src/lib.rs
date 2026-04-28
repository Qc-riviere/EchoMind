use tauri::Manager;

mod commands;

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

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                loop {
                    interval.tick().await;
                    let state: tauri::State<'_, AppCore> = app_handle.state();
                    match state.0.bridge_sync_pull().await {
                        Ok(n) if n > 0 => {
                            use tauri_plugin_notification::NotificationExt;
                            let _ = app_handle
                                .notification()
                                .builder()
                                .title("EchoMind")
                                .body(format!("从云端同步到 {n} 条新灵感"))
                                .show();
                            let _ = tauri::Emitter::emit(&app_handle, "bridge:synced", n);
                        }
                        Err(e) => {
                            eprintln!("[bridge-sync] {e}");
                        }
                        _ => {}
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
