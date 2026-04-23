use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection};

use crate::error::AppError;

extern "C" {
    fn sqlite3_vec_init(
        db: *mut rusqlite::ffi::sqlite3,
        pz_err_msg: *mut *mut std::os::raw::c_char,
        p_api: *const rusqlite::ffi::sqlite3_api_routines,
    ) -> std::os::raw::c_int;
}

unsafe fn register_sqlite_vec(conn: &Connection) -> rusqlite::Result<()> {
    let db = unsafe { conn.handle() };
    let rc = unsafe { sqlite3_vec_init(db, std::ptr::null_mut(), std::ptr::null()) };
    if rc != 0 {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rc),
            Some("sqlite-vec init failed".into()),
        ));
    }
    Ok(())
}

/// One opened SQLite connection per device, guarded by a Mutex.
/// Bridge server is single-process; per-device file keeps blast radius small.
pub struct DeviceStore {
    conn: Mutex<Connection>,
}

impl DeviceStore {
    pub fn open(data_dir: &Path, device_id: &str) -> Result<Self, AppError> {
        if !is_safe_device_id(device_id) {
            return Err(AppError::BadRequest("invalid device_id".into()));
        }
        let dir = data_dir.join("devices");
        std::fs::create_dir_all(&dir).map_err(|e| AppError::Internal(format!("mkdir: {e}")))?;
        let path = dir.join(format!("{device_id}.db"));
        let conn = Connection::open(&path).map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA foreign_keys=ON;
             PRAGMA busy_timeout=5000;",
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;
        unsafe { register_sqlite_vec(&conn).map_err(|e| AppError::Internal(e.to_string()))?; }
        init_schema(&conn).map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn upsert_thought(&self, t: &SubsetThought) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        let tags_json = serde_json::to_string(&t.tags.clone().unwrap_or_default())
            .map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT INTO thoughts (id, content, domain, tags, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                content = excluded.content,
                domain  = excluded.domain,
                tags    = excluded.tags,
                updated_at = excluded.updated_at",
            params![t.id, t.content, t.domain, tags_json, t.created_at, t.updated_at],
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;

        if let Some(emb) = &t.embedding {
            if emb.len() != 1536 {
                return Err(AppError::BadRequest(format!(
                    "embedding dim must be 1536, got {}",
                    emb.len()
                )));
            }
            // Re-insert: vec0 doesn't support ON CONFLICT, so delete+insert.
            conn.execute(
                "DELETE FROM thought_embeddings WHERE thought_id = ?1",
                params![t.id],
            )
            .map_err(|e| AppError::Internal(e.to_string()))?;
            let bytes: Vec<u8> = emb.iter().flat_map(|f| f.to_le_bytes()).collect();
            conn.execute(
                "INSERT INTO thought_embeddings (thought_id, embedding) VALUES (?1, ?2)",
                params![t.id, bytes],
            )
            .map_err(|e| AppError::Internal(e.to_string()))?;
        }
        Ok(())
    }

    pub fn capture_thought(
        &self,
        content: &str,
        domain: Option<&str>,
        tags: Option<&[String]>,
    ) -> Result<ThoughtRow, AppError> {
        let id = uuid::Uuid::new_v4().simple().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let tags_json = serde_json::to_string(&tags.unwrap_or(&[]))
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO thoughts (id, content, domain, tags, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            rusqlite::params![id, content, domain, tags_json, now],
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(ThoughtRow {
            id,
            content: content.to_string(),
            domain: domain.map(|s| s.to_string()),
            tags: tags.map(|t| t.to_vec()),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn list_thoughts(&self, limit: i64) -> Result<Vec<ThoughtRow>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, content, domain, tags, created_at, updated_at
                 FROM thoughts ORDER BY updated_at DESC LIMIT ?1",
            )
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let rows = stmt
            .query_map(params![limit.clamp(1, 200)], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                ))
            })
            .map_err(|e| AppError::Internal(e.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(rows
            .into_iter()
            .map(|(id, content, domain, tags_json, created_at, updated_at)| {
                let tags = tags_json.and_then(|s| serde_json::from_str(&s).ok());
                ThoughtRow { id, content, domain, tags, created_at, updated_at }
            })
            .collect())
    }

    pub fn search_thoughts(&self, query: &str, limit: i64) -> Result<Vec<ThoughtRow>, AppError> {
        let conn = self.conn.lock().unwrap();
        let pattern = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));
        let mut stmt = conn
            .prepare(
                "SELECT id, content, domain, tags, created_at, updated_at
                 FROM thoughts WHERE content LIKE ?1 ESCAPE '\\'
                 ORDER BY updated_at DESC LIMIT ?2",
            )
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let rows = stmt
            .query_map(params![pattern, limit.clamp(1, 50)], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                ))
            })
            .map_err(|e| AppError::Internal(e.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(rows
            .into_iter()
            .map(|(id, content, domain, tags_json, created_at, updated_at)| {
                let tags = tags_json.and_then(|s| serde_json::from_str(&s).ok());
                ThoughtRow { id, content, domain, tags, created_at, updated_at }
            })
            .collect())
    }

    pub fn delete_thoughts(&self, ids: &[String]) -> Result<usize, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut n = 0;
        for id in ids {
            conn.execute(
                "DELETE FROM thought_embeddings WHERE thought_id = ?1",
                params![id],
            )
            .map_err(|e| AppError::Internal(e.to_string()))?;
            n += conn
                .execute("DELETE FROM thoughts WHERE id = ?1", params![id])
                .map_err(|e| AppError::Internal(e.to_string()))?;
        }
        Ok(n)
    }

    pub fn destroy(data_dir: &Path, device_id: &str) -> Result<(), AppError> {
        if !is_safe_device_id(device_id) {
            return Err(AppError::BadRequest("invalid device_id".into()));
        }
        let path: PathBuf = data_dir.join("devices").join(format!("{device_id}.db"));
        for suffix in ["", "-wal", "-shm"] {
            let p = PathBuf::from(format!("{}{}", path.display(), suffix));
            if p.exists() {
                let _ = std::fs::remove_file(&p);
            }
        }
        Ok(())
    }
}

#[derive(serde::Serialize)]
pub struct ThoughtRow {
    pub id: String,
    pub content: String,
    pub domain: Option<String>,
    pub tags: Option<Vec<String>>,
    pub created_at: String,
    pub updated_at: String,
}

pub struct SubsetThought {
    pub id: String,
    pub content: String,
    pub domain: Option<String>,
    pub tags: Option<Vec<String>>,
    pub created_at: String,
    pub updated_at: String,
    pub embedding: Option<Vec<f32>>,
}

fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS thoughts (
            id          TEXT PRIMARY KEY,
            content     TEXT NOT NULL,
            domain      TEXT,
            tags        TEXT,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );",
    )?;
    let vec_exists: bool = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='thought_embeddings'",
            [],
            |row| row.get::<_, i32>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false);
    if !vec_exists {
        conn.execute_batch(
            "CREATE VIRTUAL TABLE thought_embeddings USING vec0(
                thought_id TEXT PRIMARY KEY,
                embedding float[1536]
            );",
        )?;
    }
    Ok(())
}

fn is_safe_device_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}
