use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;

type AppState = Arc<echomind_core::EchoMind>;

// ── Request types ────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateThoughtReq {
    pub content: String,
    pub image_path: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateThoughtReq {
    pub content: String,
}

#[derive(Deserialize)]
pub struct SearchReq {
    pub query: String,
}

#[derive(Deserialize)]
pub struct SendMessageReq {
    pub content: String,
}

#[derive(Deserialize)]
pub struct ListQuery {
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

// ── Error helper ─────────────────────────────────────────

fn err(msg: String) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({ "error": msg })),
    )
}

// ── Routes ───────────────────────────────────────────────

pub fn api_routes() -> Router<AppState> {
    Router::new()
        // Thoughts
        .route("/thoughts", post(create_thought).get(list_thoughts))
        .route("/thoughts/{id}", get(get_thought).put(update_thought))
        .route("/thoughts/{id}/archive", post(archive_thought))
        .route("/thoughts/{id}/unarchive", post(unarchive_thought))
        .route("/thoughts/{id}/enrich", post(enrich_thought))
        .route("/thoughts/{id}/embed", post(embed_thought))
        .route("/thoughts/{id}/related", post(find_related))
        .route("/thoughts/{id}/chat", post(start_chat))
        .route("/thoughts/archived", get(list_archived))
        // Conversations
        .route(
            "/conversations/{id}/messages",
            get(get_messages).post(send_message),
        )
        // Search & Status
        .route("/search", post(search))
        .route("/status", get(status))
        // Images
        .route("/images/{filename}", get(serve_image))
        // Settings (read-only for bridge)
        .route("/settings", get(get_all_settings))
        .route("/settings/{key}", get(get_setting))
}

// ── Thought handlers ─────────────────────────────────────

async fn create_thought(
    State(core): State<AppState>,
    Json(req): Json<CreateThoughtReq>,
) -> impl IntoResponse {
    let result = if let Some(ref img_path) = req.image_path {
        core.create_thought_with_image(&req.content, img_path)
    } else {
        core.create_thought(&req.content)
    };
    match result {
        Ok(thought) => (StatusCode::CREATED, Json(serde_json::to_value(thought).unwrap())).into_response(),
        Err(e) => err(e).into_response(),
    }
}

async fn list_thoughts(
    State(core): State<AppState>,
    Query(q): Query<ListQuery>,
) -> impl IntoResponse {
    match core.list_thoughts() {
        Ok(mut thoughts) => {
            let offset = q.offset.unwrap_or(0);
            let limit = q.limit.unwrap_or(thoughts.len());
            if offset < thoughts.len() {
                thoughts = thoughts[offset..].to_vec();
            } else {
                thoughts = vec![];
            }
            thoughts.truncate(limit);
            Json(serde_json::to_value(thoughts).unwrap()).into_response()
        }
        Err(e) => err(e).into_response(),
    }
}

async fn get_thought(
    State(core): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match core.get_thought(&id) {
        Ok(thought) => Json(serde_json::to_value(thought).unwrap()).into_response(),
        Err(e) => err(e).into_response(),
    }
}

async fn update_thought(
    State(core): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateThoughtReq>,
) -> impl IntoResponse {
    match core.update_thought(&id, &req.content) {
        Ok(thought) => Json(serde_json::to_value(thought).unwrap()).into_response(),
        Err(e) => err(e).into_response(),
    }
}

async fn archive_thought(
    State(core): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match core.archive_thought(&id) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err(e).into_response(),
    }
}

async fn unarchive_thought(
    State(core): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match core.unarchive_thought(&id) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err(e).into_response(),
    }
}

async fn list_archived(State(core): State<AppState>) -> impl IntoResponse {
    match core.list_archived_thoughts() {
        Ok(thoughts) => Json(serde_json::to_value(thoughts).unwrap()).into_response(),
        Err(e) => err(e).into_response(),
    }
}

async fn enrich_thought(
    State(core): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match core.enrich_thought(&id).await {
        Ok(thought) => Json(serde_json::to_value(thought).unwrap()).into_response(),
        Err(e) => err(e).into_response(),
    }
}

async fn embed_thought(
    State(core): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match core.embed_thought(&id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err(e).into_response(),
    }
}

async fn find_related(
    State(core): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match core.find_related_thoughts(&id).await {
        Ok(thoughts) => Json(serde_json::to_value(thoughts).unwrap()).into_response(),
        Err(e) => err(e).into_response(),
    }
}

// ── Conversation handlers ────────────────────────────────

async fn start_chat(
    State(core): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match core.start_chat(&id) {
        Ok(conv) => (StatusCode::CREATED, Json(serde_json::to_value(conv).unwrap())).into_response(),
        Err(e) => err(e).into_response(),
    }
}

async fn get_messages(
    State(core): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match core.get_chat_messages(&id) {
        Ok(msgs) => Json(serde_json::to_value(msgs).unwrap()).into_response(),
        Err(e) => err(e).into_response(),
    }
}

async fn send_message(
    State(core): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<SendMessageReq>,
) -> impl IntoResponse {
    match core.send_chat_message(&id, &req.content).await {
        Ok(reply) => Json(serde_json::json!({ "reply": reply })).into_response(),
        Err(e) => err(e).into_response(),
    }
}

// ── Search & Status ──────────────────────────────────────

async fn search(
    State(core): State<AppState>,
    Json(req): Json<SearchReq>,
) -> impl IntoResponse {
    match core.semantic_search(&req.query).await {
        Ok(thoughts) => Json(serde_json::to_value(thoughts).unwrap()).into_response(),
        Err(e) => err(e).into_response(),
    }
}

async fn status(State(core): State<AppState>) -> impl IntoResponse {
    match core.status() {
        Ok(s) => Json(s).into_response(),
        Err(e) => err(e).into_response(),
    }
}

// ── Image handler ───────────────────────────────────────

async fn serve_image(Path(filename): Path<String>) -> impl IntoResponse {
    // Prevent path traversal
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return (StatusCode::BAD_REQUEST, "Invalid filename").into_response();
    }

    let images_dir = dirs::data_dir()
        .expect("Cannot determine data directory")
        .join("com.fu-qianchen.echomind")
        .join("images");
    let file_path = images_dir.join(&filename);

    match tokio::fs::read(&file_path).await {
        Ok(data) => {
            let content_type = if filename.ends_with(".png") {
                "image/png"
            } else if filename.ends_with(".gif") {
                "image/gif"
            } else if filename.ends_with(".webp") {
                "image/webp"
            } else {
                "image/jpeg"
            };
            (
                StatusCode::OK,
                [(axum::http::header::CONTENT_TYPE, content_type)],
                data,
            ).into_response()
        }
        Err(_) => (StatusCode::NOT_FOUND, "Image not found").into_response(),
    }
}

// ── Settings handlers ───────────────────────────────────

async fn get_all_settings(State(core): State<AppState>) -> impl IntoResponse {
    match core.get_all_settings() {
        Ok(settings) => {
            let map: serde_json::Map<String, serde_json::Value> = settings
                .into_iter()
                .map(|(k, v)| (k, serde_json::Value::String(v)))
                .collect();
            Json(serde_json::Value::Object(map)).into_response()
        }
        Err(e) => err(e).into_response(),
    }
}

async fn get_setting(
    State(core): State<AppState>,
    Path(key): Path<String>,
) -> impl IntoResponse {
    match core.get_setting(&key) {
        Ok(Some(value)) => Json(serde_json::json!({ "value": value })).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Setting not found" }))).into_response(),
        Err(e) => err(e).into_response(),
    }
}
