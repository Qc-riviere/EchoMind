use axum::{
    extract::{Request, State},
    http::{header::AUTHORIZATION, HeaderValue},
    middleware::Next,
    response::Response,
};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::state::AppState;

/// Sliding TTL applied on every successful authed request. Matches the
/// initial `/bridge/pair` TTL — clients that talk to us at least once a year
/// stay paired indefinitely.
const SLIDING_TTL_SECS: i64 = 60 * 60 * 24 * 365;

/// JWT claims. `sub` identifies the paired device (sync_key fingerprint).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,
    pub exp: usize,
}

#[derive(Clone, Debug)]
pub struct AuthContext {
    pub device_id: String,
}

pub fn issue_token(secret: &str, device_id: &str, ttl_secs: i64) -> Result<String, AppError> {
    let exp = (chrono::Utc::now() + chrono::Duration::seconds(ttl_secs)).timestamp() as usize;
    let claims = Claims { sub: device_id.to_string(), exp };
    encode(&Header::default(), &claims, &EncodingKey::from_secret(secret.as_bytes()))
        .map_err(|e| AppError::Internal(format!("jwt encode: {e}")))
}

pub async fn require_auth(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let header = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::Unauthorized("missing Authorization header".into()))?;

    let token = header
        .strip_prefix("Bearer ")
        .ok_or_else(|| AppError::Unauthorized("expected Bearer token".into()))?;

    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(state.config.jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|e| AppError::Unauthorized(format!("invalid token: {e}")))?;

    let device_id = data.claims.sub.clone();
    req.extensions_mut().insert(AuthContext { device_id: device_id.clone() });
    let mut response = next.run(req).await;

    // Sliding TTL: every successful authed call refreshes the token to a fresh
    // 1-year window. Clients that read `X-Refresh-Token` persist it; old
    // clients still get a year from initial pair.
    if let Ok(new_token) = issue_token(&state.config.jwt_secret, &device_id, SLIDING_TTL_SECS) {
        if let Ok(hv) = HeaderValue::from_str(&new_token) {
            response.headers_mut().insert("x-refresh-token", hv);
        }
    }

    Ok(response)
}
