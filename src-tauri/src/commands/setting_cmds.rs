use tauri::State;

use crate::db::settings;
use crate::DbState;

#[tauri::command]
pub fn get_setting(state: State<DbState>, key: String) -> Result<Option<String>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    settings::get_setting(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting(state: State<DbState>, key: String, value: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    settings::set_setting(&conn, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_setting(state: State<DbState>, key: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    settings::delete_setting(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_all_settings(state: State<DbState>) -> Result<Vec<(String, String)>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    settings::get_all_settings(&conn).map_err(|e| e.to_string())
}
