use reqwest::Client;
use serde_json::{json, Value};

use super::EmbeddingConfig;

/// Detect if the base_url points to Gemini API
fn is_gemini(base_url: &str) -> bool {
    base_url.contains("generativelanguage.googleapis.com")
}

/// Call Gemini embedding API
async fn generate_embedding_gemini(text: &str, config: &EmbeddingConfig) -> Result<Vec<f32>, String> {
    let model = if config.model.is_empty() { "text-embedding-004" } else { &config.model };
    let url = format!(
        "{}/models/{}:embedContent?key={}",
        config.base_url.trim_end_matches('/'),
        model,
        config.api_key
    );

    let body = json!({
        "model": format!("models/{}", model),
        "content": { "parts": [{ "text": text }] },
        "outputDimensionality": config.dimensions
    });

    let resp = Client::new()
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gemini embedding request failed: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!("Gemini Embedding API error ({}): {}", status, text));
    }

    let json: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;

    let embedding = json["embedding"]["values"]
        .as_array()
        .ok_or("No embedding values in Gemini response")?
        .iter()
        .map(|v| v.as_f64().unwrap_or(0.0) as f32)
        .collect::<Vec<f32>>();

    if embedding.len() != config.dimensions as usize {
        return Err(format!(
            "Embedding dimension mismatch: expected {}, got {}",
            config.dimensions,
            embedding.len()
        ));
    }

    Ok(embedding)
}

/// Call OpenAI-compatible embedding API
async fn generate_embedding_openai(text: &str, config: &EmbeddingConfig) -> Result<Vec<f32>, String> {
    let body = json!({
        "model": config.model,
        "input": text,
    });

    let resp = Client::new()
        .post(&config.base_url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Embedding request failed: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!("Embedding API error ({}): {}", status, text));
    }

    let json: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;

    let embedding = json["data"][0]["embedding"]
        .as_array()
        .ok_or("No embedding in response")?
        .iter()
        .map(|v| v.as_f64().unwrap_or(0.0) as f32)
        .collect::<Vec<f32>>();

    if embedding.len() != config.dimensions as usize {
        return Err(format!(
            "Embedding dimension mismatch: expected {}, got {}",
            config.dimensions,
            embedding.len()
        ));
    }

    Ok(embedding)
}

pub async fn generate_embedding(text: &str, config: &EmbeddingConfig) -> Result<Vec<f32>, String> {
    if is_gemini(&config.base_url) {
        generate_embedding_gemini(text, config).await
    } else {
        generate_embedding_openai(text, config).await
    }
}
