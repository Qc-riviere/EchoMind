use rusqlite::{params, Connection, Result};

/// Store an embedding for a thought
pub fn store_embedding(conn: &Connection, thought_id: &str, embedding: &[f32]) -> Result<()> {
    // Convert f32 slice to raw bytes for sqlite-vec
    let bytes: Vec<u8> = embedding
        .iter()
        .flat_map(|f| f.to_le_bytes())
        .collect();

    conn.execute(
        "INSERT OR REPLACE INTO thought_embeddings (thought_id, embedding) VALUES (?1, ?2)",
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

    let mut stmt = conn.prepare(
        "SELECT thought_id, distance
         FROM thought_embeddings
         WHERE embedding MATCH ?1
         ORDER BY distance
         LIMIT ?2",
    )?;

    let rows = stmt.query_map(params![bytes, limit as i64], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
    })?;

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

    let mut stmt = conn.prepare(
        "SELECT thought_id, distance
         FROM thought_embeddings
         WHERE embedding MATCH ?1
           AND thought_id != ?2
         ORDER BY distance
         LIMIT ?3",
    )?;

    let rows = stmt.query_map(params![embedding, thought_id, limit as i64], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
    })?;

    rows.collect()
}

/// Delete embedding for a thought
pub fn delete_embedding(conn: &Connection, thought_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM thought_embeddings WHERE thought_id = ?1",
        params![thought_id],
    )?;
    Ok(())
}
