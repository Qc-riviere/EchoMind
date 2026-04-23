use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::config::Config;
use crate::db::DeviceStore;
use crate::error::AppError;
use crate::pairing::PairingStore;

/// Per-device sliding-window rate limiter for /bridge/chat.
/// Allows up to `limit` calls per `window_secs` seconds.
pub struct ChatRateLimiter {
    window_secs: u64,
    limit: u32,
    /// device_id → (call_count_in_window, window_start)
    state: Mutex<HashMap<String, (u32, Instant)>>,
}

impl ChatRateLimiter {
    pub fn new(limit: u32, window_secs: u64) -> Self {
        Self { limit, window_secs, state: Mutex::new(HashMap::new()) }
    }

    /// Returns Ok(remaining) if allowed, Err(retry_after_secs) if rate-limited.
    pub fn check(&self, device_id: &str) -> Result<u32, u64> {
        let mut guard = self.state.lock().unwrap();
        let now = Instant::now();
        let entry = guard.entry(device_id.to_string()).or_insert((0, now));
        if now.duration_since(entry.1).as_secs() >= self.window_secs {
            *entry = (0, now);
        }
        if entry.0 >= self.limit {
            let retry = self.window_secs.saturating_sub(now.duration_since(entry.1).as_secs());
            return Err(retry.max(1));
        }
        entry.0 += 1;
        Ok(self.limit - entry.0)
    }
}

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub pairings: Arc<PairingStore>,
    pub chat_limiter: Arc<ChatRateLimiter>,
    stores: Arc<Mutex<HashMap<String, Arc<DeviceStore>>>>,
}

impl AppState {
    pub fn new(config: Config) -> Result<Self, AppError> {
        let pairings = Arc::new(PairingStore::open(&config.data_dir)?);
        // 20 chat calls per 60 seconds per device (matches nginx upstream limit)
        let chat_limiter = Arc::new(ChatRateLimiter::new(20, 60));
        Ok(Self {
            config: Arc::new(config),
            pairings,
            chat_limiter,
            stores: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    pub fn store_for(&self, device_id: &str) -> Result<Arc<DeviceStore>, AppError> {
        let mut guard = self.stores.lock().unwrap();
        if let Some(s) = guard.get(device_id) {
            return Ok(s.clone());
        }
        let store = Arc::new(DeviceStore::open(&self.config.data_dir, device_id)?);
        guard.insert(device_id.to_string(), store.clone());
        Ok(store)
    }

    pub fn drop_store(&self, device_id: &str) {
        self.stores.lock().unwrap().remove(device_id);
    }
}
