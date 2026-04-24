use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppCore;
use echomind_core::bridge::{settings_keys, RemoteLlmStatus, SubsetRules};

#[derive(Debug, Serialize)]
pub struct CloudBridgeStatus {
    pub paired: bool,
    pub enabled: bool,
    pub server_url: Option<String>,
    pub device_id: Option<String>,
    pub sync_key_fp: Option<String>,
    pub rules: SubsetRules,
}

#[tauri::command]
pub fn cloud_bridge_status(state: State<AppCore>) -> Result<CloudBridgeStatus, String> {
    let core = &state.0;
    let server_url = core.get_setting(settings_keys::SERVER_URL)?;
    let token = core.get_setting(settings_keys::TOKEN)?;
    let device_id = core.get_setting(settings_keys::DEVICE_ID)?;
    let sync_key_fp = core.get_setting(settings_keys::SYNC_KEY_FP)?;
    let rules = core.bridge_get_subset_rules()?;
    let enabled = core.bridge_is_enabled()?;
    Ok(CloudBridgeStatus {
        paired: token.as_deref().is_some_and(|t| !t.is_empty()),
        enabled,
        server_url,
        device_id,
        sync_key_fp,
        rules,
    })
}

#[derive(Debug, Deserialize)]
pub struct PairArgs {
    pub server_url: String,
    pub device_code: String,
}

#[tauri::command]
pub async fn cloud_bridge_pair(
    state: State<'_, AppCore>,
    args: PairArgs,
) -> Result<String, String> {
    state.0.bridge_pair(&args.server_url, &args.device_code).await
}

#[tauri::command]
pub fn cloud_bridge_set_enabled(state: State<AppCore>, enabled: bool) -> Result<(), String> {
    state.0.bridge_set_enabled(enabled)
}

#[tauri::command]
pub fn cloud_bridge_set_rules(state: State<AppCore>, rules: SubsetRules) -> Result<(), String> {
    state.0.bridge_set_subset_rules(&rules)
}

#[tauri::command]
pub async fn cloud_bridge_initial_sync(state: State<'_, AppCore>) -> Result<usize, String> {
    state.0.bridge_initial_sync().await
}

#[tauri::command]
pub async fn cloud_bridge_sync_pull(state: State<'_, AppCore>) -> Result<usize, String> {
    state.0.bridge_sync_pull().await
}

#[tauri::command]
pub async fn cloud_bridge_terminate(state: State<'_, AppCore>) -> Result<(), String> {
    state.0.bridge_terminate().await
}

#[tauri::command]
pub async fn cloud_bridge_push_llm_config(
    state: State<'_, AppCore>,
    budget_cents: Option<i64>,
) -> Result<(), String> {
    state.0.bridge_push_llm_config(budget_cents).await
}

#[tauri::command]
pub async fn cloud_bridge_clear_llm_config(
    state: State<'_, AppCore>,
) -> Result<(), String> {
    state.0.bridge_clear_llm_config().await
}

#[tauri::command]
pub async fn cloud_bridge_remote_llm_status(
    state: State<'_, AppCore>,
) -> Result<RemoteLlmStatus, String> {
    state.0.bridge_remote_llm_status().await
}
