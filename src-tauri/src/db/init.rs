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

    // Create vector table — sqlite-vec virtual table
    // We store dimensions in settings; default to 1536
    // vec0 tables use a different CREATE syntax, so we check if it exists first
    let vec_table_exists: bool = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='thought_embeddings'",
            [],
            |row| row.get::<_, i32>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false);

    if !vec_table_exists {
        conn.execute_batch(
            "CREATE VIRTUAL TABLE thought_embeddings USING vec0(
                thought_id TEXT PRIMARY KEY,
                embedding float[1536]
            );",
        )?;
    }

    Ok(conn)
}
