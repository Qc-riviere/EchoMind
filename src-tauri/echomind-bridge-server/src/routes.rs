use axum::{
    middleware,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;

use crate::auth::{issue_token, require_auth, AuthContext};
use crate::db::SubsetThought;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub fn router(state: AppState) -> Router {
    let public = Router::new()
        .route("/health", get(health))
        .route("/bridge/pair", post(pair));

    let protected = Router::new()
        .route("/bridge/config", post(config_upsert).get(config_get))
        .route("/bridge/thoughts/upsert", post(thoughts_upsert))
        .route("/bridge/thoughts/delete", post(thoughts_delete))
        .route("/bridge/terminate", post(terminate))
        .route("/bridge/chat", post(bridge_chat))
        .route("/bridge/status", get(bridge_status))
        .route("/bridge/thoughts", get(bridge_list_thoughts))
        .route("/bridge/thoughts/search", post(bridge_search_thoughts))
        .route("/bridge/thoughts/capture", post(bridge_capture_thought))
        .layer(middleware::from_fn_with_state(state.clone(), require_auth));

    let admin = Router::new()
        .route("/admin/pair-codes", post(admin_issue_code).get(admin_list_codes))
        .route("/admin/pair-codes/{code}", axum::routing::delete(admin_revoke_code))
        .route("/admin/devices", get(admin_list_devices))
        .route("/admin/audit", get(admin_list_audit))
        .route("/admin/devices/{id}/usage-reset", post(admin_usage_reset))
        .route("/admin/devices/{id}/budget", post(admin_set_budget));

    Router::new().merge(public).merge(protected).merge(admin).with_state(state)
}

// ── Public ──────────────────────────────────────────────

async fn health() -> Json<serde_json::Value> {
    Json(json!({ "ok": true }))
}

#[derive(Deserialize)]
struct PairReq {
    /// Device code printed in desktop UI; user enters it on VPS first-time.
    device_code: String,
    /// Public sync_key fingerprint (what becomes JWT sub).
    sync_key_fp: String,
}

async fn pair(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(req): Json<PairReq>,
) -> AppResult<Json<serde_json::Value>> {
    if req.device_code.trim().is_empty() || req.sync_key_fp.trim().is_empty() {
        return Err(AppError::BadRequest("device_code and sync_key_fp required".into()));
    }
    if req.sync_key_fp.len() < 16 || req.sync_key_fp.len() > 128 {
        return Err(AppError::BadRequest("sync_key_fp length out of range".into()));
    }
    let row = state
        .pairings
        .consume(req.device_code.trim(), req.sync_key_fp.trim())?;
    state.pairings.audit(Some(&row.device_id), "bridge.pair", None);
    let token = issue_token(&state.config.jwt_secret, &row.device_id, 60 * 60 * 24 * 30)?;
    Ok(Json(json!({
        "token": token,
        "device_id": row.device_id,
    })))
}

// ── Admin ───────────────────────────────────────────────

#[derive(Deserialize)]
struct AdminIssueReq {
    ttl_secs: Option<i64>,
}

fn check_admin(state: &AppState, headers: &axum::http::HeaderMap) -> AppResult<()> {
    let token = headers
        .get("x-admin-token")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::Unauthorized("missing x-admin-token".into()))?;
    if token != state.config.admin_token {
        return Err(AppError::Unauthorized("bad admin token".into()));
    }
    Ok(())
}

async fn admin_issue_code(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<AdminIssueReq>,
) -> AppResult<Json<serde_json::Value>> {
    check_admin(&state, &headers)?;
    let ttl = req.ttl_secs.unwrap_or(600).clamp(60, 3600);
    let _ = state.pairings.purge_expired();
    let code = state.pairings.issue_code(ttl)?;
    state.pairings.audit(None, "admin.pair_code.issue", Some(&format!("ttl={ttl}")));
    Ok(Json(json!({ "code": code, "ttl_secs": ttl })))
}

async fn admin_list_codes(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: axum::http::HeaderMap,
) -> AppResult<Json<serde_json::Value>> {
    check_admin(&state, &headers)?;
    let rows = state.pairings.list_pending_codes()?;
    Ok(Json(json!({ "codes": rows })))
}

async fn admin_revoke_code(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: axum::http::HeaderMap,
    axum::extract::Path(code): axum::extract::Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    check_admin(&state, &headers)?;
    let n = state.pairings.revoke_code(&code)?;
    state.pairings.audit(None, "admin.pair_code.revoke", Some(&code));
    if n == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(json!({ "revoked": n })))
}

async fn admin_list_devices(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: axum::http::HeaderMap,
) -> AppResult<Json<serde_json::Value>> {
    check_admin(&state, &headers)?;
    let rows = state.pairings.list_devices()?;
    Ok(Json(json!({ "devices": rows })))
}

#[derive(Deserialize)]
struct AuditQuery {
    limit: Option<i64>,
}

async fn admin_list_audit(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: axum::http::HeaderMap,
    axum::extract::Query(q): axum::extract::Query<AuditQuery>,
) -> AppResult<Json<serde_json::Value>> {
    check_admin(&state, &headers)?;
    let rows = state.pairings.list_audit(q.limit.unwrap_or(200))?;
    Ok(Json(json!({ "entries": rows })))
}

// ── Protected ───────────────────────────────────────────

#[derive(Deserialize)]
struct ConfigReq {
    bot_token: Option<String>,
    subset_rules: Option<serde_json::Value>,
    llm_config: Option<serde_json::Value>,
    /// Budget in USD cents; null = unlimited.
    budget_cents: Option<i64>,
}

async fn config_upsert(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::Extension(auth): axum::Extension<AuthContext>,
    Json(req): Json<ConfigReq>,
) -> AppResult<Json<serde_json::Value>> {
    state.store_for(&auth.device_id)?;

    let key = &state.config.encryption_key;
    let bot_enc = match req.bot_token.as_deref() {
        Some(t) if !t.is_empty() => Some(crate::crypto::encrypt(key, t.as_bytes())?),
        _ => None,
    };
    let llm_enc = match &req.llm_config {
        Some(v) if !v.is_null() => {
            let s = serde_json::to_string(v).map_err(|e| AppError::BadRequest(e.to_string()))?;
            Some(crate::crypto::encrypt(key, s.as_bytes())?)
        }
        _ => None,
    };
    let subset_str = match &req.subset_rules {
        Some(v) if !v.is_null() => {
            Some(serde_json::to_string(v).map_err(|e| AppError::BadRequest(e.to_string()))?)
        }
        _ => None,
    };

    state.pairings.upsert_config(
        &auth.device_id,
        bot_enc.as_deref(),
        subset_str.as_deref(),
        llm_enc.as_deref(),
    )?;
    if req.budget_cents.is_some() {
        state.pairings.set_budget(&auth.device_id, req.budget_cents)?;
    }
    let fields: Vec<&str> = [
        ("bot_token", bot_enc.is_some()),
        ("subset_rules", subset_str.is_some()),
        ("llm_config", llm_enc.is_some()),
        ("budget_cents", req.budget_cents.is_some()),
    ]
    .iter()
    .filter(|(_, p)| *p)
    .map(|(n, _)| *n)
    .collect();
    state.pairings.audit(
        Some(&auth.device_id),
        "bridge.config.upsert",
        Some(&fields.join(",")),
    );
    Ok(Json(json!({ "ok": true, "device_id": auth.device_id })))
}

async fn config_get(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::Extension(auth): axum::Extension<AuthContext>,
) -> AppResult<Json<serde_json::Value>> {
    let s = state.pairings.get_config_summary(&auth.device_id)?;
    let subset: serde_json::Value = match s.subset_rules {
        Some(t) => serde_json::from_str(&t).unwrap_or(json!(null)),
        None => json!(null),
    };
    Ok(Json(json!({
        "device_id": auth.device_id,
        "has_bot_token": s.has_bot_token,
        "has_llm_config": s.has_llm_config,
        "subset_rules": subset,
        "updated_at": s.updated_at,
        "budget_cents": s.budget_cents,
        "usage_cents": s.usage_cents,
        "llm_disabled": s.llm_disabled,
    })))
}

#[derive(Deserialize)]
struct ThoughtUpsert {
    id: String,
    content: String,
    created_at: String,
    updated_at: String,
    tags: Option<Vec<String>>,
    domain: Option<String>,
    embedding: Option<Vec<f32>>,
}

#[derive(Deserialize)]
struct UpsertReq {
    thoughts: Vec<ThoughtUpsert>,
}

async fn thoughts_upsert(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::Extension(auth): axum::Extension<AuthContext>,
    Json(req): Json<UpsertReq>,
) -> AppResult<Json<serde_json::Value>> {
    let store = state.store_for(&auth.device_id)?;
    let total = req.thoughts.len();
    let mut n = 0usize;
    for t in req.thoughts {
        store.upsert_thought(&SubsetThought {
            id: t.id,
            content: t.content,
            domain: t.domain,
            tags: t.tags,
            created_at: t.created_at,
            updated_at: t.updated_at,
            embedding: t.embedding,
        })?;
        n += 1;
    }
    state.pairings.audit(
        Some(&auth.device_id),
        "bridge.thoughts.upsert",
        Some(&format!("n={total}")),
    );
    Ok(Json(json!({
        "ok": true,
        "device_id": auth.device_id,
        "accepted": n,
    })))
}

#[derive(Deserialize)]
struct DeleteReq {
    ids: Vec<String>,
}

async fn thoughts_delete(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::Extension(auth): axum::Extension<AuthContext>,
    Json(req): Json<DeleteReq>,
) -> AppResult<Json<serde_json::Value>> {
    let store = state.store_for(&auth.device_id)?;
    let deleted = store.delete_thoughts(&req.ids)?;
    state.pairings.audit(
        Some(&auth.device_id),
        "bridge.thoughts.delete",
        Some(&format!("n={deleted}")),
    );
    Ok(Json(json!({
        "ok": true,
        "device_id": auth.device_id,
        "deleted": deleted,
    })))
}

async fn terminate(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::Extension(auth): axum::Extension<AuthContext>,
) -> AppResult<Json<serde_json::Value>> {
    state.drop_store(&auth.device_id);
    state.pairings.delete_config(&auth.device_id)?;
    crate::db::DeviceStore::destroy(&state.config.data_dir, &auth.device_id)?;
    state.pairings.audit(Some(&auth.device_id), "bridge.terminate", None);
    Ok(Json(json!({ "ok": true, "device_id": auth.device_id })))
}

// ── Bridge thought reads ─────────────────────────────────

#[derive(Deserialize)]
struct ListQuery {
    limit: Option<i64>,
}

async fn bridge_list_thoughts(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::Extension(auth): axum::Extension<AuthContext>,
    axum::extract::Query(q): axum::extract::Query<ListQuery>,
) -> AppResult<Json<serde_json::Value>> {
    let store = state.store_for(&auth.device_id)?;
    let thoughts = store.list_thoughts(q.limit.unwrap_or(20))?;
    Ok(Json(json!({ "thoughts": thoughts })))
}

#[derive(Deserialize)]
struct SearchReq {
    query: String,
    limit: Option<i64>,
}

async fn bridge_search_thoughts(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::Extension(auth): axum::Extension<AuthContext>,
    Json(req): Json<SearchReq>,
) -> AppResult<Json<serde_json::Value>> {
    if req.query.trim().is_empty() {
        return Err(AppError::BadRequest("query is empty".into()));
    }
    let store = state.store_for(&auth.device_id)?;
    let thoughts = store.search_thoughts(req.query.trim(), req.limit.unwrap_or(10))?;
    Ok(Json(json!({ "thoughts": thoughts })))
}

// ── Bridge capture ──────────────────────────────────────

#[derive(Deserialize)]
struct CaptureReq {
    content: String,
    #[serde(default)]
    domain: Option<String>,
    #[serde(default)]
    tags: Option<Vec<String>>,
}

async fn bridge_capture_thought(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::Extension(auth): axum::Extension<AuthContext>,
    Json(req): Json<CaptureReq>,
) -> AppResult<Json<serde_json::Value>> {
    if req.content.trim().is_empty() {
        return Err(AppError::BadRequest("content is empty".into()));
    }
    let store = state.store_for(&auth.device_id)?;
    let thought = store.capture_thought(
        req.content.trim(),
        req.domain.as_deref(),
        req.tags.as_deref(),
    )?;
    state.pairings.audit(Some(&auth.device_id), "bridge.thoughts.capture", None);
    Ok(Json(json!({
        "id": thought.id,
        "content": thought.content,
        "created_at": thought.created_at,
    })))
}

// ── Bridge chat ─────────────────────────────────────────

#[derive(Deserialize)]
struct ChatReq {
    messages: Vec<crate::llm::ChatMsg>,
}

async fn bridge_chat(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::Extension(auth): axum::Extension<AuthContext>,
    Json(req): Json<ChatReq>,
) -> AppResult<Json<serde_json::Value>> {
    state
        .chat_limiter
        .check(&auth.device_id)
        .map_err(AppError::RateLimited)?;

    let llm_state = state
        .pairings
        .get_llm_state(&auth.device_id)?
        .ok_or_else(|| AppError::BadRequest("no LLM config stored".into()))?;
    let (enc_blob, budget, usage, disabled) = llm_state;
    if disabled {
        return Err(AppError::BadRequest(format!(
            "LLM disabled: budget {budget:?} cents, used {usage} cents"
        )));
    }
    let raw = crate::crypto::decrypt(&state.config.encryption_key, &enc_blob)?;
    let cfg: crate::llm::LlmConfig = serde_json::from_slice(&raw)
        .map_err(|e| AppError::Internal(format!("bad llm config: {e}")))?;
    if req.messages.is_empty() {
        return Err(AppError::BadRequest("messages empty".into()));
    }
    let outcome = crate::llm::call_chat(&cfg, &req.messages).await?;
    let (new_usage, now_disabled) = state
        .pairings
        .add_usage(&auth.device_id, outcome.cost_cents)?;
    state.pairings.audit(
        Some(&auth.device_id),
        "bridge.chat",
        Some(&format!(
            "tokens={}/{} cost={}c total={}c",
            outcome.prompt_tokens, outcome.completion_tokens, outcome.cost_cents, new_usage
        )),
    );
    Ok(Json(json!({
        "content": outcome.content,
        "prompt_tokens": outcome.prompt_tokens,
        "completion_tokens": outcome.completion_tokens,
        "cost_cents": outcome.cost_cents,
        "usage_cents": new_usage,
        "llm_disabled": now_disabled,
    })))
}

async fn bridge_status(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::Extension(auth): axum::Extension<AuthContext>,
) -> AppResult<Json<serde_json::Value>> {
    let s = state.pairings.get_config_summary(&auth.device_id)?;
    Ok(Json(json!({
        "has_llm_config": s.has_llm_config,
        "llm_disabled": s.llm_disabled,
        "usage_cents": s.usage_cents,
        "budget_cents": s.budget_cents,
    })))
}

// ── Admin LLM budget/usage ───────────────────────────────

async fn admin_usage_reset(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: axum::http::HeaderMap,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    check_admin(&state, &headers)?;
    state.pairings.reset_usage(&id)?;
    state.pairings.audit(Some(&id), "admin.usage.reset", None);
    Ok(Json(json!({ "ok": true, "device_id": id })))
}

#[derive(Deserialize)]
struct SetBudgetReq {
    /// null = remove cap
    budget_cents: Option<i64>,
}

async fn admin_set_budget(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: axum::http::HeaderMap,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<SetBudgetReq>,
) -> AppResult<Json<serde_json::Value>> {
    check_admin(&state, &headers)?;
    state.pairings.set_budget(&id, req.budget_cents)?;
    state
        .pairings
        .audit(Some(&id), "admin.budget.set", Some(&format!("{:?}", req.budget_cents)));
    Ok(Json(json!({ "ok": true, "device_id": id, "budget_cents": req.budget_cents })))
}
