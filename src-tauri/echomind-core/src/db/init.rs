use rusqlite::{Connection, Result};
use std::path::Path;

extern "C" {
    fn sqlite3_vec_init(
        db: *mut rusqlite::ffi::sqlite3,
        pz_err_msg: *mut *mut std::os::raw::c_char,
        p_api: *const rusqlite::ffi::sqlite3_api_routines,
    ) -> std::os::raw::c_int;
}

unsafe fn register_sqlite_vec(conn: &Connection) -> Result<()> {
    let db = unsafe { conn.handle() };
    let rc = unsafe { sqlite3_vec_init(db, std::ptr::null_mut(), std::ptr::null()) };
    if rc != 0 {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rc),
            Some("Failed to initialize sqlite-vec".to_string()),
        ));
    }
    Ok(())
}

pub fn initialize_database(db_path: &Path) -> Result<Connection> {
    let conn = Connection::open(db_path)?;

    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;
    conn.execute_batch("PRAGMA busy_timeout=5000;")?;

    // Register sqlite-vec extension
    unsafe {
        register_sqlite_vec(&conn)?;
    }

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS thoughts (
            id          TEXT PRIMARY KEY,
            content     TEXT NOT NULL,
            context     TEXT,
            domain      TEXT,
            tags        TEXT,
            is_archived INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS conversations (
            id          TEXT PRIMARY KEY,
            thought_id  TEXT NOT NULL,
            title       TEXT,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL,
            FOREIGN KEY (thought_id) REFERENCES thoughts(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS messages (
            id              TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role            TEXT NOT NULL,
            content         TEXT NOT NULL,
            created_at      TEXT NOT NULL,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );
        ",
    )?;

    // Migration: add image_path column if missing
    let has_image_path: bool = conn
        .prepare("SELECT image_path FROM thoughts LIMIT 0")
        .is_ok();
    if !has_image_path {
        conn.execute_batch("ALTER TABLE thoughts ADD COLUMN image_path TEXT;")?;
    }

    // Migration: add file_summary column if missing
    let has_file_summary: bool = conn
        .prepare("SELECT file_summary FROM thoughts LIMIT 0")
        .is_ok();
    if !has_file_summary {
        conn.execute_batch("ALTER TABLE thoughts ADD COLUMN file_summary TEXT;")?;
    }

    // Resolve desired embedding dimension from settings, defaulting to the
    // local-model default (512) for fresh installs and falling back to 1536
    // when any cloud embedding has already been configured.
    let desired_dim: u32 = {
        let dim_setting: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'embedding_dimensions'",
                [],
                |row| row.get(0),
            )
            .ok();
        dim_setting
            .as_deref()
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(512)
    };

    let table_sql: Option<String> = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='thought_embeddings'",
            [],
            |row| row.get(0),
        )
        .ok();

    let current_dim: Option<u32> = table_sql.as_deref().and_then(|sql| {
        let needle = "float[";
        let start = sql.find(needle)? + needle.len();
        let end = sql[start..].find(']')? + start;
        sql[start..end].trim().parse().ok()
    });

    let needs_recreate = match current_dim {
        None => true,
        Some(d) if d != desired_dim => {
            eprintln!(
                "[db] embedding dim mismatch (table={}, desired={}); recreating vector table — thoughts will need re-embedding",
                d, desired_dim
            );
            true
        }
        _ => false,
    };

    if needs_recreate {
        if current_dim.is_some() {
            conn.execute_batch("DROP TABLE thought_embeddings;")?;
        }
        conn.execute_batch(&format!(
            "CREATE VIRTUAL TABLE thought_embeddings USING vec0(
                thought_id TEXT PRIMARY KEY,
                embedding float[{}]
            );",
            desired_dim
        ))?;
    }

    Ok(conn)
}
