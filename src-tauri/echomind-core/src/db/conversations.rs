use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Conversation {
    pub id: String,
    pub thought_id: String,
    pub title: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

pub fn create_conversation(conn: &Connection, thought_id: &str) -> Result<Conversation> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO conversations (id, thought_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, thought_id, now, now],
    )?;

    get_conversation(conn, &id)
}

pub fn get_conversation(conn: &Connection, id: &str) -> Result<Conversation> {
    conn.query_row(
        "SELECT id, thought_id, title, created_at, updated_at FROM conversations WHERE id = ?1",
        params![id],
        |row| {
            Ok(Conversation {
                id: row.get(0)?,
                thought_id: row.get(1)?,
                title: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    )
}

pub fn add_message(
    conn: &Connection,
    conversation_id: &str,
    role: &str,
    content: &str,
) -> Result<Message> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, conversation_id, role, content, now],
    )?;

    // Update conversation timestamp
    conn.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        params![now, conversation_id],
    )?;

    Ok(Message {
        id,
        conversation_id: conversation_id.to_string(),
        role: role.to_string(),
        content: content.to_string(),
        created_at: now,
    })
}

pub fn get_messages(conn: &Connection, conversation_id: &str) -> Result<Vec<Message>> {
    let mut stmt = conn.prepare(
        "SELECT id, conversation_id, role, content, created_at
         FROM messages WHERE conversation_id = ?1
         ORDER BY created_at ASC",
    )?;

    let rows = stmt.query_map(params![conversation_id], |row| {
        Ok(Message {
            id: row.get(0)?,
            conversation_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;

    rows.collect()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConversationWithPreview {
    pub id: String,
    pub thought_id: String,
    pub title: Option<String>,
    pub thought_preview: String,
    pub created_at: String,
    pub updated_at: String,
}

pub fn list_recent_conversations(conn: &Connection, limit: usize) -> Result<Vec<ConversationWithPreview>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.thought_id, c.title, COALESCE(t.file_summary, t.content, '') as preview, c.created_at, c.updated_at
         FROM conversations c
         LEFT JOIN thoughts t ON t.id = c.thought_id
         ORDER BY c.updated_at DESC
         LIMIT ?1",
    )?;

    let rows = stmt.query_map(params![limit], |row| {
        Ok(ConversationWithPreview {
            id: row.get(0)?,
            thought_id: row.get(1)?,
            title: row.get(2)?,
            thought_preview: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })?;

    rows.collect()
}

/// Delete a message and all subsequent messages in the same conversation.
/// Used for "withdraw": removes the user message and the AI reply that followed.
pub fn withdraw_message(conn: &Connection, message_id: &str) -> Result<Vec<String>> {
    // Find the message to get its conversation_id and created_at
    let (conversation_id, created_at): (String, String) = conn.query_row(
        "SELECT conversation_id, created_at FROM messages WHERE id = ?1",
        params![message_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    // Collect IDs of messages to be deleted (this message and all after it)
    let mut stmt = conn.prepare(
        "SELECT id FROM messages WHERE conversation_id = ?1 AND created_at >= ?2 ORDER BY created_at ASC",
    )?;
    let deleted_ids: Vec<String> = stmt
        .query_map(params![conversation_id, created_at], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    // Delete them
    conn.execute(
        "DELETE FROM messages WHERE conversation_id = ?1 AND created_at >= ?2",
        params![conversation_id, created_at],
    )?;

    Ok(deleted_ids)
}

pub fn get_conversations_for_thought(
    conn: &Connection,
    thought_id: &str,
) -> Result<Vec<Conversation>> {
    let mut stmt = conn.prepare(
        "SELECT id, thought_id, title, created_at, updated_at
         FROM conversations WHERE thought_id = ?1
         ORDER BY updated_at DESC",
    )?;

    let rows = stmt.query_map(params![thought_id], |row| {
        Ok(Conversation {
            id: row.get(0)?,
            thought_id: row.get(1)?,
            title: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;

    rows.collect()
}
