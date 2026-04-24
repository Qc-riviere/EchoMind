pub mod client;
pub mod rules;

use rand::RngCore;

pub use client::{
    BridgeClient, ChatMessage as BridgeChatMessage, PairResponse, RemoteChatResponse,
    RemoteLlmStatus, RemoteThought, SubsetThoughtPayload,
};
pub use rules::SubsetRules;

/// Settings keys used to persist bridge state in the `settings` table.
pub mod settings_keys {
    pub const SERVER_URL: &str = "bridge_server_url";
    pub const TOKEN: &str = "bridge_token";
    pub const DEVICE_ID: &str = "bridge_device_id";
    pub const SYNC_KEY: &str = "bridge_sync_key";
    pub const SYNC_KEY_FP: &str = "bridge_sync_key_fp";
    pub const SUBSET_RULES: &str = "bridge_subset_rules";
    pub const ENABLED: &str = "bridge_enabled";
    /// RFC3339 cursor: largest `updated_at` we've already pulled from bridge.
    pub const LAST_SYNC_AT: &str = "bridge_last_sync_at";
}

/// Generate a 32-byte sync key, base64-encoded. Used to fingerprint the
/// local install when pairing — the VPS never sees the raw key.
pub fn generate_sync_key() -> String {
    use base64::Engine;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// SHA-256 hex fingerprint of the sync key — this is what's sent to the VPS
/// on pairing and stored in JWT subject. Safe to expose.
pub fn fingerprint_sync_key(key_b64: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(key_b64.as_bytes());
    let digest = h.finalize();
    hex::encode(digest)
}
