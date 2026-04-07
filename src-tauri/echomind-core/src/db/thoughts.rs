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
    pub is_archived: bool,
    pub created_at: String,
    pub updated_at: String,
}

pub fn create_thought(conn: &Connection, content: &str) -> Result<Thought> {
    create_thought_with_image(conn, content, None)
}

pub fn create_thought_with_image(conn: &Connection, content: &str, image_path: Option<&str>) -> Result<Thought> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO thoughts (id, content, image_path, is_archived, created_at, updated_at)
         VALUES (?1, ?2, ?3, 0, ?4, ?5)",
        params![id, content, image_path, now, now],
    )?;

    get_thought(conn, &id)
}

pub fn list_thoughts(conn: &Connection) -> Result<Vec<Thought>> {
    let mut stmt = conn.prepare(
        "SELECT id, content, context, domain, tags, image_path, is_archived, created_at, updated_at
         FROM thoughts
         WHERE is_archived = 0
         ORDER BY created_at DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(Thought {
            id: row.get(0)?,
            content: row.get(1)?,
            context: row.get(2)?,
            domain: row.get(3)?,
            tags: row.get(4)?,
            image_path: row.get(5)?,
            is_archived: row.get::<_, i32>(6)? != 0,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    })?;

    rows.collect()
}

pub fn get_thought(conn: &Connection, id: &str) -> Result<Thought> {
    conn.query_row(
        "SELECT id, content, context, domain, tags, image_path, is_archived, created_at, updated_at
         FROM thoughts WHERE id = ?1",
        params![id],
        |row| {
            Ok(Thought {
                id: row.get(0)?,
                content: row.get(1)?,
                context: row.get(2)?,
                domain: row.get(3)?,
                tags: row.get(4)?,
                image_path: row.get(5)?,
                is_archived: row.get::<_, i32>(6)? != 0,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    )
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
    let mut stmt = conn.prepare(
        "SELECT id, content, context, domain, tags, image_path, is_archived, created_at, updated_at
         FROM thoughts
         WHERE is_archived = 1
         ORDER BY updated_at DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(Thought {
            id: row.get(0)?,
            content: row.get(1)?,
            context: row.get(2)?,
            domain: row.get(3)?,
            tags: row.get(4)?,
            image_path: row.get(5)?,
            is_archived: row.get::<_, i32>(6)? != 0,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    })?;

    rows.collect()
}

pub fn delete_thought(conn: &Connection, id: &str) -> Result<()> {
    let mut get_convs_stmt = conn.prepare("SELECT id FROM conversations WHERE thought_id = ?1")?;
    let conversation_ids: Vec<String> = get_convs_stmt
        .query_map(params![id], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();
    drop(get_convs_stmt);

    for conv_id in &conversation_ids {
        conn.execute(
            "DELETE FROM messages WHERE conversation_id = ?1",
            params![conv_id],
        )?;
    }

    conn.execute(
        "DELETE FROM conversations WHERE thought_id = ?1",
        params![id],
    )?;

    conn.execute(
        "DELETE FROM thought_embeddings WHERE thought_id = ?1",
        params![id],
    )?;

    conn.execute("DELETE FROM thoughts WHERE id = ?1", params![id])?;
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

pub fn update_thought_enrichment(
    conn: &Connection,
    id: &str,
    context: &str,
    domain: &str,
    tags: &str,
) -> Result<Thought> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE thoughts SET context = ?1, domain = ?2, tags = ?3, updated_at = ?4 WHERE id = ?5",
        params![context, domain, tags, now, id],
    )?;
    get_thought(conn, id)
}
