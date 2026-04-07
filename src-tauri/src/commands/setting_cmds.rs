use tauri::State;

use crate::AppCore;

#[tauri::command]
pub fn get_setting(state: State<AppCore>, key: String) -> Result<Option<String>, String> {
    state.0.get_setting(&key)
}

#[tauri::command]
pub fn set_setting(state: State<AppCore>, key: String, value: String) -> Result<(), String> {
    state.0.set_setting(&key, &value)
}

#[tauri::command]
pub fn delete_setting(state: State<AppCore>, key: String) -> Result<(), String> {
    state.0.delete_setting(&key)
}

#[tauri::command]
pub fn get_all_settings(state: State<AppCore>) -> Result<Vec<(String, String)>, String> {
    state.0.get_all_settings()
}
