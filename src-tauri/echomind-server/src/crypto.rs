use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::Engine;
use rand::RngCore;

const KEYRING_SERVICE: &str = "EchoMind";
const KEYRING_USER: &str = "wechat-token-key";

fn get_or_create_key() -> Result<[u8; 32], String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("keyring init failed: {e}"))?;

    match entry.get_password() {
        Ok(b64) => {
            let raw = base64::engine::general_purpose::STANDARD
                .decode(b64.as_bytes())
                .map_err(|e| format!("stored key base64 decode failed: {e}"))?;
            if raw.len() != 32 {
                return Err(format!("stored key has wrong length: {}", raw.len()));
            }
            let mut out = [0u8; 32];
            out.copy_from_slice(&raw);
            Ok(out)
        }
        Err(keyring::Error::NoEntry) => {
            let mut key = [0u8; 32];
            OsRng.fill_bytes(&mut key);
            let b64 = base64::engine::general_purpose::STANDARD.encode(key);
            entry
                .set_password(&b64)
                .map_err(|e| format!("keyring set failed: {e}"))?;
            Ok(key)
        }
        Err(e) => Err(format!("keyring read failed: {e}")),
    }
}

/// Encrypt a plaintext blob. Returns base64(nonce || ciphertext).
pub fn encrypt(plaintext: &[u8]) -> Result<String, String> {
    let key_bytes = get_or_create_key()?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);

    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("encrypt failed: {e}"))?;

    let mut buf = Vec::with_capacity(12 + ciphertext.len());
    buf.extend_from_slice(&nonce_bytes);
    buf.extend_from_slice(&ciphertext);
    Ok(base64::engine::general_purpose::STANDARD.encode(buf))
}

/// Decrypt base64(nonce || ciphertext) back to plaintext.
pub fn decrypt(envelope_b64: &str) -> Result<Vec<u8>, String> {
    let raw = base64::engine::general_purpose::STANDARD
        .decode(envelope_b64.as_bytes())
        .map_err(|e| format!("envelope base64 decode failed: {e}"))?;

    if raw.len() < 13 {
        return Err("envelope too short".to_string());
    }

    let (nonce_bytes, ciphertext) = raw.split_at(12);
    let key_bytes = get_or_create_key()?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("decrypt failed: {e}"))
}
