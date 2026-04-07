use tauri::Manager;

mod commands;

pub struct AppCore(pub echomind_core::EchoMind);

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to get app data dir");
            std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");

            let db_path = app_dir.join("echomind.db");
            let core = echomind_core::EchoMind::open(&db_path)
                .expect("failed to initialize database");

            app.manage(AppCore(core));
            app.manage(commands::bridge_cmds::BridgeState::default());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::thought_cmds::create_thought,
            commands::thought_cmds::list_thoughts,
            commands::thought_cmds::get_thought,
            commands::thought_cmds::update_thought,
            commands::thought_cmds::archive_thought,
            commands::thought_cmds::list_archived_thoughts,
            commands::thought_cmds::unarchive_thought,
            commands::thought_cmds::delete_thought,
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
            commands::chat_cmds::get_conversations,
            commands::chat_cmds::start_chat,
            commands::chat_cmds::get_chat_messages,
            commands::chat_cmds::send_chat_message,
            commands::bridge_cmds::bridge_server_status,
            commands::bridge_cmds::bridge_start_server,
            commands::bridge_cmds::bridge_stop_server,
            commands::bridge_cmds::bridge_wechat_account,
            commands::bridge_cmds::bridge_wechat_project_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
