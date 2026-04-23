use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::Engine;
use rand::RngCore;

use crate::error::AppError;

/// Encrypt plaintext with AES-256-GCM. Output = base64(nonce(12) || ciphertext+tag).
pub fn encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<String, AppError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| AppError::Internal(format!("encrypt: {e}")))?;
    let mut buf = Vec::with_capacity(12 + ct.len());
    buf.extend_from_slice(&nonce_bytes);
    buf.extend_from_slice(&ct);
    Ok(base64::engine::general_purpose::STANDARD.encode(&buf))
}

pub fn decrypt(key: &[u8; 32], blob_b64: &str) -> Result<Vec<u8>, AppError> {
    let buf = base64::engine::general_purpose::STANDARD
        .decode(blob_b64)
        .map_err(|e| AppError::Internal(format!("decrypt base64: {e}")))?;
    if buf.len() < 13 {
        return Err(AppError::Internal("ciphertext too short".into()));
    }
    let (nonce_bytes, ct) = buf.split_at(12);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ct)
        .map_err(|e| AppError::Internal(format!("decrypt: {e}")))
}
