//! Embedding-config fallback matrix.
//!
//! These tests pin the decision tree in `load_embedding_config_from_conn` so
//! a future refactor can't silently regress the v0.3.5 fix that taught
//! DeepSeek/Claude users to fall back to local BGE instead of 401-ing
//! against api.openai.com with the wrong key.
//!
//! Truth table (the "8 combos" from D1):
//!   1. emb_provider="local"                  → local bge-small-zh-v1.5
//!   2. fully unconfigured                    → local
//!   3. emb_api_key set                       → cloud OpenAI-compatible
//!   4. llm preset=openai + llm key           → OpenAI embeddings
//!   5. llm preset=gemini + llm key           → Gemini embeddings
//!   6. llm preset=deepseek + llm key         → local fallback (v0.3.5 fix)
//!   7. llm preset=claude + llm key           → local fallback
//!   8. llm preset=unknown + llm key          → local fallback

mod common;

use common::make_test_core;

const LOCAL_BASE: &str = "local";
const LOCAL_MODEL: &str = "bge-small-zh-v1.5";

#[test]
fn case_1_explicit_local_provider_returns_local() {
    let (_dir, core) = make_test_core();
    core.set_setting("embedding_provider", "local").unwrap();
    // Even with a stray cloud key lying around, "local" wins.
    core.set_setting("embedding_api_key", "sk-stale").unwrap();

    let cfg = core.load_embedding_config().expect("load");
    assert_eq!(cfg.base_url, LOCAL_BASE);
    assert_eq!(cfg.model, LOCAL_MODEL);
}

#[test]
fn case_2_no_keys_at_all_returns_local() {
    let (_dir, core) = make_test_core();
    let cfg = core.load_embedding_config().expect("load");
    assert_eq!(cfg.base_url, LOCAL_BASE);
    assert_eq!(cfg.model, LOCAL_MODEL);
}

#[test]
fn case_3_explicit_emb_key_uses_openai_compatible_cloud() {
    let (_dir, core) = make_test_core();
    core.set_setting("embedding_api_key", "sk-emb-explicit")
        .unwrap();
    // No emb_base_url → falls back to OpenAI's URL.
    let cfg = core.load_embedding_config().expect("load");
    assert_eq!(cfg.api_key, "sk-emb-explicit");
    assert!(cfg.base_url.contains("api.openai.com"));
}

#[test]
fn case_4_openai_preset_routes_to_openai_embeddings() {
    let (_dir, core) = make_test_core();
    core.set_setting("llm_provider_preset", "openai").unwrap();
    core.set_setting("llm_api_key", "sk-openai-llm").unwrap();

    let cfg = core.load_embedding_config().expect("load");
    assert!(cfg.base_url.contains("api.openai.com"));
    assert_eq!(cfg.api_key, "sk-openai-llm");
}

#[test]
fn case_5_gemini_preset_routes_to_gemini_embeddings() {
    let (_dir, core) = make_test_core();
    core.set_setting("llm_provider_preset", "gemini").unwrap();
    core.set_setting("llm_api_key", "gemini-key").unwrap();

    let cfg = core.load_embedding_config().expect("load");
    assert!(cfg.base_url.contains("generativelanguage.googleapis.com"));
    assert_eq!(cfg.api_key, "gemini-key");
}

/// Regression for v0.3.5 (commit c775da0). Before the fix, DeepSeek users —
/// whose backend literally is "openai" — silently fell into the OpenAI arm
/// and hit api.openai.com with a DeepSeek key, returning 401 forever.
#[test]
fn case_6_deepseek_preset_falls_back_to_local() {
    let (_dir, core) = make_test_core();
    core.set_setting("llm_provider_preset", "deepseek").unwrap();
    // Backend is "openai" — must not influence the preset-based fallback.
    core.set_setting("llm_provider", "openai").unwrap();
    core.set_setting("llm_api_key", "sk-deepseek").unwrap();

    let cfg = core.load_embedding_config().expect("load");
    assert_eq!(cfg.base_url, LOCAL_BASE);
    assert_eq!(cfg.model, LOCAL_MODEL);
}

#[test]
fn case_7_claude_preset_falls_back_to_local() {
    let (_dir, core) = make_test_core();
    core.set_setting("llm_provider_preset", "claude").unwrap();
    core.set_setting("llm_api_key", "sk-ant-anything").unwrap();

    let cfg = core.load_embedding_config().expect("load");
    assert_eq!(cfg.base_url, LOCAL_BASE);
    assert_eq!(cfg.model, LOCAL_MODEL);
}

#[test]
fn case_8_unknown_preset_falls_back_to_local() {
    let (_dir, core) = make_test_core();
    core.set_setting("llm_provider_preset", "mysteryprovider-9001")
        .unwrap();
    core.set_setting("llm_api_key", "whatever").unwrap();

    let cfg = core.load_embedding_config().expect("load");
    assert_eq!(cfg.base_url, LOCAL_BASE);
    assert_eq!(cfg.model, LOCAL_MODEL);
}
