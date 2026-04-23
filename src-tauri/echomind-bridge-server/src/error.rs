use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("unauthorized: {0}")]
    Unauthorized(String),
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("not found")]
    NotFound,
    #[error("internal: {0}")]
    Internal(String),
    #[error("upstream error: {0}")]
    Upstream(String),
    #[error("rate limited: retry after {0}s")]
    RateLimited(u64),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        if let AppError::RateLimited(retry_after) = self {
            let body = Json(json!({ "error": format!("rate limited: retry after {retry_after}s") }));
            let mut resp = (StatusCode::TOO_MANY_REQUESTS, body).into_response();
            resp.headers_mut().insert(
                "Retry-After",
                HeaderValue::from_str(&retry_after.to_string()).unwrap(),
            );
            return resp;
        }
        let (status, msg) = match &self {
            AppError::Unauthorized(_) => (StatusCode::UNAUTHORIZED, self.to_string()),
            AppError::BadRequest(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            AppError::NotFound => (StatusCode::NOT_FOUND, self.to_string()),
            AppError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
            AppError::Upstream(_) => (StatusCode::BAD_GATEWAY, self.to_string()),
            AppError::RateLimited(_) => unreachable!(),
        };
        (status, Json(json!({ "error": msg }))).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;
