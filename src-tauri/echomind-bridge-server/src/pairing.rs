use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppError;

pub struct PairingStore {
    conn: Mutex<Connection>,
}

pub struct PairingRow {
    pub device_id: String,
    pub sync_key_fp: String,
}

#[derive(serde::Serialize)]
pub struct AuditRow {
    pub ts: i64,
    pub device_id: Option<String>,
    pub action: String,
    pub detail: Option<String>,
}

#[derive(serde::Serialize)]
pub struct PendingCodeRow {
    pub code: String,
    pub expires_at: i64,
    pub consumed_at: Option<i64>,
}

#[derive(serde::Serialize)]
pub struct DeviceRow {
    pub device_id: String,
    pub paired_at: i64,
    pub config_updated_at: Option<i64>,
    pub has_bot_token: bool,
    pub has_llm_config: bool,
}

#[derive(Default)]
pub struct ConfigSummary {
    pub has_bot_token: bool,
    pub subset_rules: Option<String>,
    pub has_llm_config: bool,
    pub updated_at: Option<i64>,
    pub budget_cents: Option<i64>,
    pub usage_cents: i64,
    pub llm_disabled: bool,
}

impl PairingStore {
    pub fn open(data_dir: &Path) -> Result<Self, AppError> {
        std::fs::create_dir_all(data_dir).map_err(|e| AppError::Internal(e.to_string()))?;
        let conn = Connection::open(data_dir.join("server.db"))
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA busy_timeout=5000;
             CREATE TABLE IF NOT EXISTS pending_pairings (
                code        TEXT PRIMARY KEY,
                expires_at  INTEGER NOT NULL,
                consumed_at INTEGER
             );
             CREATE TABLE IF NOT EXISTS devices (
                device_id    TEXT PRIMARY KEY,
                sync_key_fp  TEXT NOT NULL UNIQUE,
                paired_at    INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS audit_log (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                ts          INTEGER NOT NULL,
                device_id   TEXT,
                action      TEXT NOT NULL,
                detail      TEXT
             );
             CREATE INDEX IF NOT EXISTS audit_ts ON audit_log(ts DESC);
             CREATE TABLE IF NOT EXISTS device_configs (
                device_id      TEXT PRIMARY KEY,
                bot_token_enc  TEXT,
                subset_rules   TEXT,
                llm_config_enc TEXT,
                updated_at     INTEGER NOT NULL,
                budget_cents   INTEGER,
                usage_cents    INTEGER NOT NULL DEFAULT 0,
                llm_disabled   INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
             );",
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;
        // Best-effort migrations for pre-existing deployments.
        for stmt in [
            "ALTER TABLE device_configs ADD COLUMN budget_cents INTEGER",
            "ALTER TABLE device_configs ADD COLUMN usage_cents INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE device_configs ADD COLUMN llm_disabled INTEGER NOT NULL DEFAULT 0",
        ] {
            let _ = conn.execute(stmt, []);
        }
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn issue_code(&self, ttl_secs: i64) -> Result<String, AppError> {
        let code = generate_code();
        let expires_at = chrono::Utc::now().timestamp() + ttl_secs;
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO pending_pairings (code, expires_at) VALUES (?1, ?2)",
            params![code, expires_at],
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(code)
    }

    /// Atomically consume a code and bind it to sync_key_fp. Returns the new device_id.
    pub fn consume(&self, code: &str, sync_key_fp: &str) -> Result<PairingRow, AppError> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction().map_err(|e| AppError::Internal(e.to_string()))?;

        let now = chrono::Utc::now().timestamp();
        let row: Option<(i64, Option<i64>)> = tx
            .query_row(
                "SELECT expires_at, consumed_at FROM pending_pairings WHERE code = ?1",
                params![code],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let (expires_at, consumed_at) = row
            .ok_or_else(|| AppError::Unauthorized("unknown pairing code".into()))?;
        if consumed_at.is_some() {
            return Err(AppError::Unauthorized("pairing code already used".into()));
        }
        if expires_at < now {
            return Err(AppError::Unauthorized("pairing code expired".into()));
        }

        // Reuse existing device row if this sync_key_fp was paired before.
        let existing: Option<String> = tx
            .query_row(
                "SELECT device_id FROM devices WHERE sync_key_fp = ?1",
                params![sync_key_fp],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let device_id = match existing {
            Some(id) => id,
            None => {
                let id = format!("dev_{}", uuid::Uuid::new_v4().simple());
                tx.execute(
                    "INSERT INTO devices (device_id, sync_key_fp, paired_at) VALUES (?1, ?2, ?3)",
                    params![id, sync_key_fp, now],
                )
                .map_err(|e| AppError::Internal(e.to_string()))?;
                id
            }
        };

        tx.execute(
            "UPDATE pending_pairings SET consumed_at = ?1 WHERE code = ?2",
            params![now, code],
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;

        tx.commit().map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(PairingRow { device_id, sync_key_fp: sync_key_fp.to_string() })
    }

    pub fn upsert_config(
        &self,
        device_id: &str,
        bot_token_enc: Option<&str>,
        subset_rules: Option<&str>,
        llm_config_enc: Option<&str>,
    ) -> Result<(), AppError> {
        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.lock().unwrap();
        // COALESCE: if caller passed None, keep existing value.
        conn.execute(
            "INSERT INTO device_configs (device_id, bot_token_enc, subset_rules, llm_config_enc, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(device_id) DO UPDATE SET
                bot_token_enc  = COALESCE(excluded.bot_token_enc, device_configs.bot_token_enc),
                subset_rules   = COALESCE(excluded.subset_rules, device_configs.subset_rules),
                llm_config_enc = COALESCE(excluded.llm_config_enc, device_configs.llm_config_enc),
                updated_at     = excluded.updated_at",
            params![device_id, bot_token_enc, subset_rules, llm_config_enc, now],
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(())
    }

    pub fn get_config_summary(&self, device_id: &str) -> Result<ConfigSummary, AppError> {
        let conn = self.conn.lock().unwrap();
        type Row = (Option<String>, Option<String>, Option<String>, i64, Option<i64>, i64, i64);
        let row: Option<Row> = conn
            .query_row(
                "SELECT bot_token_enc, subset_rules, llm_config_enc, updated_at,
                        budget_cents, usage_cents, llm_disabled
                 FROM device_configs WHERE device_id = ?1",
                params![device_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
            )
            .optional()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(match row {
            Some((bt, sr, llm, ts, budget, usage, disabled)) => ConfigSummary {
                has_bot_token: bt.is_some(),
                subset_rules: sr,
                has_llm_config: llm.is_some(),
                updated_at: Some(ts),
                budget_cents: budget,
                usage_cents: usage,
                llm_disabled: disabled != 0,
            },
            None => ConfigSummary::default(),
        })
    }

    /// Read the encrypted LLM config blob plus current budget/usage/disabled state.
    pub fn get_llm_state(
        &self,
        device_id: &str,
    ) -> Result<Option<(String, Option<i64>, i64, bool)>, AppError> {
        let conn = self.conn.lock().unwrap();
        let row: Option<(Option<String>, Option<i64>, i64, i64)> = conn
            .query_row(
                "SELECT llm_config_enc, budget_cents, usage_cents, llm_disabled
                 FROM device_configs WHERE device_id = ?1",
                params![device_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(row.and_then(|(enc, b, u, d)| enc.map(|e| (e, b, u, d != 0))))
    }

    /// Increment usage, auto-disable if over budget. Returns (new_usage, disabled_now).
    pub fn add_usage(&self, device_id: &str, delta_cents: i64) -> Result<(i64, bool), AppError> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction().map_err(|e| AppError::Internal(e.to_string()))?;
        let (budget, usage): (Option<i64>, i64) = tx
            .query_row(
                "SELECT budget_cents, usage_cents FROM device_configs WHERE device_id = ?1",
                params![device_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let new_usage = usage.saturating_add(delta_cents.max(0));
        let disabled = matches!(budget, Some(b) if new_usage >= b);
        tx.execute(
            "UPDATE device_configs SET usage_cents = ?1, llm_disabled = ?2 WHERE device_id = ?3",
            params![new_usage, disabled as i64, device_id],
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;
        tx.commit().map_err(|e| AppError::Internal(e.to_string()))?;
        Ok((new_usage, disabled))
    }

    pub fn set_budget(&self, device_id: &str, budget_cents: Option<i64>) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE device_configs SET budget_cents = ?1 WHERE device_id = ?2",
            params![budget_cents, device_id],
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(())
    }

    pub fn reset_usage(&self, device_id: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE device_configs SET usage_cents = 0, llm_disabled = 0 WHERE device_id = ?1",
            params![device_id],
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(())
    }

    pub fn delete_config(&self, device_id: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM device_configs WHERE device_id = ?1",
            params![device_id],
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(())
    }

    pub fn audit(&self, device_id: Option<&str>, action: &str, detail: Option<&str>) {
        let ts = chrono::Utc::now().timestamp();
        if let Ok(conn) = self.conn.lock() {
            let _ = conn.execute(
                "INSERT INTO audit_log (ts, device_id, action, detail) VALUES (?1, ?2, ?3, ?4)",
                params![ts, device_id, action, detail],
            );
        }
    }

    pub fn list_audit(&self, limit: i64) -> Result<Vec<AuditRow>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT ts, device_id, action, detail FROM audit_log
                 ORDER BY ts DESC LIMIT ?1",
            )
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let rows = stmt
            .query_map(params![limit.clamp(1, 1000)], |r| {
                Ok(AuditRow {
                    ts: r.get(0)?,
                    device_id: r.get(1)?,
                    action: r.get(2)?,
                    detail: r.get(3)?,
                })
            })
            .map_err(|e| AppError::Internal(e.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(rows)
    }

    pub fn list_pending_codes(&self) -> Result<Vec<PendingCodeRow>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT code, expires_at, consumed_at FROM pending_pairings
                 ORDER BY expires_at DESC LIMIT 100",
            )
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let rows = stmt
            .query_map([], |r| {
                Ok(PendingCodeRow {
                    code: r.get(0)?,
                    expires_at: r.get(1)?,
                    consumed_at: r.get(2)?,
                })
            })
            .map_err(|e| AppError::Internal(e.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(rows)
    }

    /// Revoke an unconsumed pairing code. Returns number of rows affected.
    pub fn revoke_code(&self, code: &str) -> Result<usize, AppError> {
        let conn = self.conn.lock().unwrap();
        let n = conn
            .execute(
                "DELETE FROM pending_pairings WHERE code = ?1 AND consumed_at IS NULL",
                params![code],
            )
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(n)
    }

    pub fn list_devices(&self) -> Result<Vec<DeviceRow>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT d.device_id, d.paired_at, c.updated_at, c.bot_token_enc IS NOT NULL,
                        c.llm_config_enc IS NOT NULL
                 FROM devices d LEFT JOIN device_configs c ON c.device_id = d.device_id
                 ORDER BY d.paired_at DESC",
            )
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let rows = stmt
            .query_map([], |r| {
                Ok(DeviceRow {
                    device_id: r.get(0)?,
                    paired_at: r.get(1)?,
                    config_updated_at: r.get(2)?,
                    has_bot_token: r.get(3)?,
                    has_llm_config: r.get(4)?,
                })
            })
            .map_err(|e| AppError::Internal(e.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(rows)
    }

    pub fn purge_expired(&self) -> Result<(), AppError> {
        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM pending_pairings WHERE expires_at < ?1 AND consumed_at IS NULL",
            params![now],
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(())
    }
}

fn generate_code() -> String {
    // 8-char, no ambiguous chars.
    const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let uuid = uuid::Uuid::new_v4();
    let bytes = uuid.as_bytes();
    let mut s = String::with_capacity(8);
    for i in 0..8 {
        s.push(CHARSET[(bytes[i] as usize) % CHARSET.len()] as char);
    }
    s
}
