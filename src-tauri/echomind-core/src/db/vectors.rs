use rusqlite::{params, Connection, Result};

/// Store an embedding for a thought
pub fn store_embedding(conn: &Connection, thought_id: &str, embedding: &[f32]) -> Result<()> {
    // Delete existing embedding first
    conn.execute(
        "DELETE FROM thought_embeddings WHERE thought_id = ?1",
        params![thought_id],
    )?;

    // Convert f32 slice to raw bytes for sqlite-vec
    let bytes: Vec<u8> = embedding.iter().flat_map(|f| f.to_le_bytes()).collect();

    conn.execute(
        "INSERT INTO thought_embeddings (thought_id, embedding) VALUES (?1, ?2)",
        params![thought_id, bytes],
    )?;

    Ok(())
}

/// KNN search: find the most similar thoughts to a query embedding
pub fn search_similar(
    conn: &Connection,
    query_embedding: &[f32],
    limit: usize,
) -> Result<Vec<(String, f64)>> {
    let bytes: Vec<u8> = query_embedding
        .iter()
        .flat_map(|f| f.to_le_bytes())
        .collect();

    // No absolute distance threshold — sqlite-vec's vec0 uses raw L2 by
    // default, and BGE-small-zh-v1.5 (the local default) emits un-normalized
    // vectors where typical semantic-match L2 sits in the 0.5-2.0 range. The
    // previous hard cap of 1.0 silently dropped the obvious matches GitHub
    // issue #5 was reporting (search "拍照" → 0 results despite a thought
    // titled "拍照配料表给出购买建议"). KNN top-K is the right primitive: let
    // the caller see the actual closest results regardless of magnitude.
    let mut stmt = conn.prepare(
        "SELECT thought_id, distance
         FROM thought_embeddings
         WHERE embedding MATCH ?1
         ORDER BY distance
         LIMIT ?2",
    )?;

    let rows = stmt.query_map(
        params![bytes, limit as i64],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?)),
    )?;

    rows.collect()
}

/// Find similar thoughts to a given thought (exclude self)
pub fn find_related(
    conn: &Connection,
    thought_id: &str,
    limit: usize,
) -> Result<Vec<(String, f64)>> {
    let embedding: Vec<u8> = conn.query_row(
        "SELECT embedding FROM thought_embeddings WHERE thought_id = ?1",
        params![thought_id],
        |row| row.get(0),
    )?;

    // Same reasoning as search_similar: no distance cap, just top-K closest.
    let mut stmt = conn.prepare(
        "SELECT thought_id, distance
         FROM thought_embeddings
         WHERE embedding MATCH ?1
           AND thought_id != ?2
         ORDER BY distance
         LIMIT ?3",
    )?;

    let rows = stmt.query_map(
        params![embedding, thought_id, limit as i64],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?)),
    )?;

    rows.collect()
}

/// Return all thought_ids that have an embedding stored.
pub fn get_all_embedding_ids(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT thought_id FROM thought_embeddings")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    rows.collect()
}

/// Load the raw embedding vector for a thought, if present.
pub fn get_embedding(conn: &Connection, thought_id: &str) -> Result<Option<Vec<f32>>> {
    let bytes: Option<Vec<u8>> = conn
        .query_row(
            "SELECT embedding FROM thought_embeddings WHERE thought_id = ?1",
            params![thought_id],
            |row| row.get(0),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;
    Ok(bytes.map(|b| {
        b.chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect()
    }))
}

/// Delete embedding for a thought
pub fn delete_embedding(conn: &Connection, thought_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM thought_embeddings WHERE thought_id = ?1",
        params![thought_id],
    )?;
    Ok(())
}
