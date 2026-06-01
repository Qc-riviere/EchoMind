//! Tavily-backed web search for the resource recommender.
//!
//! Why a dedicated module: the recommender used to ask the LLM to invent
//! resource URLs from training memory, which routinely produced 404s
//! (classic hallucinated paths even when the domain was right). Switching
//! to a real search call grounds the recommendations in live URLs the
//! model can only *pick from*, not invent.

use serde::{Deserialize, Serialize};

use crate::llm::http_client;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    /// Tavily's snippet — usually the most relevant 1-2 paragraphs of the
    /// page rendered as plain text. We pass it to the model so it can write
    /// a faithful one-line description without re-summarising the URL.
    pub content: String,
    /// Tavily's relevance score, 0..1. Higher = more on-topic.
    #[serde(default)]
    pub score: f64,
}

#[derive(Debug, Serialize)]
struct TavilyRequest<'a> {
    api_key: &'a str,
    query: &'a str,
    /// "basic" is one HTTP round-trip; "advanced" digs deeper but doubles
    /// latency and credit cost. Resource recommendations don't need the
    /// extra depth — a basic search already returns canonical pages.
    search_depth: &'static str,
    max_results: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    include_domains: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct TavilyResponse {
    #[serde(default)]
    results: Vec<SearchResult>,
}

/// Run a Tavily search. `query` should be a short natural-language phrase
/// (e.g. the thought's content + domain). Returns up to `max_results`
/// candidates, already sorted by Tavily's relevance score.
pub async fn tavily_search(
    api_key: &str,
    query: &str,
    max_results: u32,
) -> Result<Vec<SearchResult>, String> {
    if api_key.trim().is_empty() {
        return Err("Tavily API key not configured".into());
    }
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let body = TavilyRequest {
        api_key: api_key.trim(),
        query: query.trim(),
        search_depth: "basic",
        max_results,
        include_domains: None,
    };

    let resp = http_client()
        .post("https://api.tavily.com/search")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Tavily request failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Tavily {}: {}", status, text));
    }

    let parsed: TavilyResponse = resp
        .json()
        .await
        .map_err(|e| format!("Tavily response parse failed: {}", e))?;

    Ok(parsed.results)
}
