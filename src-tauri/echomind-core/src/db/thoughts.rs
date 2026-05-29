use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Thought {
    pub id: String,
    pub content: String,
    pub context: Option<String>,
    pub domain: Option<String>,
    pub tags: Option<String>,
    pub image_path: Option<String>,
    pub file_summary: Option<String>,
    pub is_archived: bool,
    pub is_pinned: bool,
    pub parent_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

const THOUGHT_COLS: &str = "id, content, context, domain, tags, image_path, file_summary, is_archived, created_at, updated_at, is_pinned, parent_id";

fn row_to_thought(row: &rusqlite::Row) -> rusqlite::Result<Thought> {
    Ok(Thought {
        id: row.get(0)?,
        content: row.get(1)?,
        context: row.get(2)?,
        domain: row.get(3)?,
        tags: row.get(4)?,
        image_path: row.get(5)?,
        file_summary: row.get(6)?,
        is_archived: row.get::<_, i32>(7)? != 0,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        is_pinned: row.get::<_, i32>(10)? != 0,
        parent_id: row.get(11)?,
    })
}

pub fn create_thought(conn: &Connection, content: &str) -> Result<Thought> {
    create_thought_with_image(conn, content, None)
}

pub fn create_thought_with_image(
    conn: &Connection,
    content: &str,
    image_path: Option<&str>,
) -> Result<Thought> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO thoughts (id, content, image_path, is_archived, created_at, updated_at)
         VALUES (?1, ?2, ?3, 0, ?4, ?5)",
        params![id, content, image_path, now, now],
    )?;

    get_thought(conn, &id)
}

/// Top *root* thoughts by total message count across their conversations.
/// Excludes archived and children. Only returns thoughts that have at least
/// one message (i.e. someone has actually chatted about them).
pub fn list_hot_thoughts(conn: &Connection, limit: i64) -> Result<Vec<Thought>> {
    let sql = format!(
        "SELECT {} FROM thoughts t
         JOIN conversations c ON c.thought_id = t.id
         JOIN messages m       ON m.conversation_id = c.id
         WHERE t.is_archived = 0 AND t.parent_id IS NULL
         GROUP BY t.id
         ORDER BY COUNT(m.id) DESC, MAX(m.created_at) DESC
         LIMIT ?1",
        THOUGHT_COLS
            .split(", ")
            .map(|c| format!("t.{}", c))
            .collect::<Vec<_>>()
            .join(", "),
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![limit], row_to_thought)?;
    rows.collect()
}

/// All non-archived thoughts, including children. Used by sync, embedding
/// rebuild, AI search — anywhere the full corpus is needed.
pub fn list_thoughts(conn: &Connection) -> Result<Vec<Thought>> {
    let sql = format!(
        "SELECT {} FROM thoughts WHERE is_archived = 0 ORDER BY created_at DESC",
        THOUGHT_COLS
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_thought)?;
    rows.collect()
}

/// Non-archived *root* thoughts only (parent_id IS NULL). Used by the home
/// list and any UI surface that hides follow-up children under their root.
pub fn list_root_thoughts(conn: &Connection) -> Result<Vec<Thought>> {
    let sql = format!(
        "SELECT {} FROM thoughts WHERE is_archived = 0 AND parent_id IS NULL ORDER BY created_at DESC",
        THOUGHT_COLS
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_thought)?;
    rows.collect()
}

pub fn get_thought(conn: &Connection, id: &str) -> Result<Thought> {
    let sql = format!("SELECT {} FROM thoughts WHERE id = ?1", THOUGHT_COLS);
    conn.query_row(&sql, params![id], row_to_thought)
}

/// Immediate children of a thought, ordered by created_at ASC (oldest first
/// so the visual stack reads chronologically).
pub fn list_children(conn: &Connection, parent_id: &str) -> Result<Vec<Thought>> {
    let sql = format!(
        "SELECT {} FROM thoughts WHERE parent_id = ?1 ORDER BY created_at ASC",
        THOUGHT_COLS
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![parent_id], row_to_thought)?;
    rows.collect()
}

/// All descendants of `root_id` (any depth), via recursive CTE. Order is
/// undefined — callers that care should sort.
pub fn list_descendants(conn: &Connection, root_id: &str) -> Result<Vec<Thought>> {
    let sql = format!(
        "WITH RECURSIVE descendants(id) AS (
            SELECT id FROM thoughts WHERE parent_id = ?1
            UNION ALL
            SELECT t.id FROM thoughts t JOIN descendants d ON t.parent_id = d.id
         )
         SELECT {} FROM thoughts WHERE id IN descendants",
        THOUGHT_COLS
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![root_id], row_to_thought)?;
    rows.collect()
}

/// Walk up parent_id chain until a root (parent_id IS NULL) is found.
/// Returns the root thought, or the original if it is already root.
pub fn find_root(conn: &Connection, id: &str) -> Result<Thought> {
    let mut current = get_thought(conn, id)?;
    let mut depth = 0;
    while let Some(parent_id) = current.parent_id.clone() {
        depth += 1;
        if depth > 64 {
            // Defensive: corrupt cycle? Stop walking and return what we have.
            break;
        }
        current = get_thought(conn, &parent_id)?;
    }
    Ok(current)
}

/// Most recently created root thought (parent_id IS NULL, not archived).
/// Used by WeChat "补充：" / "追加：" to resolve the implicit parent.
pub fn latest_root_thought(conn: &Connection) -> Result<Option<Thought>> {
    let sql = format!(
        "SELECT {} FROM thoughts
         WHERE is_archived = 0 AND parent_id IS NULL
         ORDER BY created_at DESC LIMIT 1",
        THOUGHT_COLS
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map([], row_to_thought)?;
    match rows.next() {
        Some(r) => r.map(Some),
        None => Ok(None),
    }
}

pub fn create_child_thought(
    conn: &Connection,
    parent_id: &str,
    content: &str,
) -> Result<Thought> {
    // Verify parent exists (returns Err if not).
    get_thought(conn, parent_id)?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO thoughts (id, content, parent_id, is_archived, created_at, updated_at)
         VALUES (?1, ?2, ?3, 0, ?4, ?5)",
        params![id, content, parent_id, now, now],
    )?;
    // Bump root's updated_at so list_root_thoughts can sort by activity if it
    // ever switches from created_at. Currently it sorts by created_at, so this
    // is forward-compat only.
    let root = find_root(conn, parent_id)?;
    conn.execute(
        "UPDATE thoughts SET updated_at = ?1 WHERE id = ?2",
        params![now, root.id],
    )?;
    get_thought(conn, &id)
}

pub fn update_thought(conn: &Connection, id: &str, content: &str) -> Result<Thought> {
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE thoughts SET content = ?1, updated_at = ?2 WHERE id = ?3",
        params![content, now, id],
    )?;

    get_thought(conn, id)
}

pub fn list_archived_thoughts(conn: &Connection) -> Result<Vec<Thought>> {
    // Only show archived roots — children stay hidden under their parent
    // (and follow their parent's archive state implicitly via UI).
    let sql = format!(
        "SELECT {} FROM thoughts
         WHERE is_archived = 1 AND parent_id IS NULL
         ORDER BY updated_at DESC",
        THOUGHT_COLS
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_thought)?;
    rows.collect()
}

pub fn delete_thought(conn: &Connection, id: &str) -> Result<()> {
    // Collect all descendant ids via recursive CTE — we cascade-delete the
    // entire subtree (N2 thread/follow-up). Includes `id` itself.
    let mut ids: Vec<String> = {
        let mut stmt = conn.prepare(
            "WITH RECURSIVE subtree(id) AS (
                SELECT ?1
                UNION ALL
                SELECT t.id FROM thoughts t JOIN subtree s ON t.parent_id = s.id
             )
             SELECT id FROM subtree",
        )?;
        let out: Vec<String> = stmt
            .query_map(params![id], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
        out
    };
    if ids.is_empty() {
        ids.push(id.to_string());
    }

    for tid in &ids {
        let conversation_ids: Vec<String> = {
            let mut stmt =
                conn.prepare("SELECT id FROM conversations WHERE thought_id = ?1")?;
            let out: Vec<String> = stmt
                .query_map(params![tid], |row| row.get(0))?
                .filter_map(|r| r.ok())
                .collect();
            out
        };
        for conv_id in &conversation_ids {
            conn.execute(
                "DELETE FROM messages WHERE conversation_id = ?1",
                params![conv_id],
            )?;
        }
        conn.execute(
            "DELETE FROM conversations WHERE thought_id = ?1",
            params![tid],
        )?;
        conn.execute(
            "DELETE FROM thought_embeddings WHERE thought_id = ?1",
            params![tid],
        )?;
        conn.execute("DELETE FROM thoughts WHERE id = ?1", params![tid])?;
    }
    Ok(())
}

pub fn unarchive_thought(conn: &Connection, id: &str) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE thoughts SET is_archived = 0, updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

pub fn archive_thought(conn: &Connection, id: &str) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE thoughts SET is_archived = 1, updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;

    Ok(())
}

/// Insert or update a thought using only remote-known fields (id, content,
/// domain, tags, created_at, updated_at). Does not touch context / image /
/// file_summary / is_archived, which are local-only. Returns true if any
/// row was inserted or updated.
pub fn upsert_from_remote(
    conn: &Connection,
    id: &str,
    content: &str,
    domain: Option<&str>,
    tags: Option<&str>,
    created_at: &str,
    updated_at: &str,
) -> Result<bool> {
    let existing_updated: Option<String> = conn
        .query_row(
            "SELECT updated_at FROM thoughts WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .ok();

    match existing_updated {
        None => {
            conn.execute(
                "INSERT INTO thoughts (id, content, domain, tags, is_archived, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)",
                params![id, content, domain, tags, created_at, updated_at],
            )?;
            Ok(true)
        }
        Some(local_updated) if updated_at.as_bytes() > local_updated.as_bytes() => {
            conn.execute(
                "UPDATE thoughts SET content = ?1, domain = ?2, tags = ?3, updated_at = ?4
                 WHERE id = ?5",
                params![content, domain, tags, updated_at, id],
            )?;
            Ok(true)
        }
        _ => Ok(false),
    }
}

/// Fetch the single pinned thought, if any. Returns None if nothing is pinned
/// (or the pinned thought has been archived/deleted).
pub fn get_pinned_thought(conn: &Connection) -> Result<Option<Thought>> {
    let sql = format!(
        "SELECT {} FROM thoughts WHERE is_pinned = 1 AND is_archived = 0 LIMIT 1",
        THOUGHT_COLS
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map([], row_to_thought)?;
    match rows.next() {
        Some(r) => r.map(Some),
        None => Ok(None),
    }
}

/// Pin or unpin a thought. Pinning enforces single-pin: any previously pinned
/// thought is unpinned first.
pub fn set_pinned(conn: &Connection, id: &str, pinned: bool) -> Result<()> {
    if pinned {
        conn.execute("UPDATE thoughts SET is_pinned = 0 WHERE is_pinned = 1", [])?;
        conn.execute(
            "UPDATE thoughts SET is_pinned = 1 WHERE id = ?1",
            params![id],
        )?;
    } else {
        conn.execute(
            "UPDATE thoughts SET is_pinned = 0 WHERE id = ?1",
            params![id],
        )?;
    }
    Ok(())
}

/// Count thoughts created since the given UTC timestamp (RFC3339).
pub fn count_thoughts_since(conn: &Connection, since: &str) -> Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM thoughts WHERE created_at >= ?1 AND is_archived = 0",
        params![since],
        |row| row.get(0),
    )
}

pub fn update_thought_enrichment(
    conn: &Connection,
    id: &str,
    context: &str,
    domain: &str,
    tags: &str,
    file_summary: Option<&str>,
) -> Result<Thought> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE thoughts SET context = ?1, domain = ?2, tags = ?3, file_summary = ?4, updated_at = ?5 WHERE id = ?6",
        params![context, domain, tags, file_summary, now, id],
    )?;
    get_thought(conn, id)
}
