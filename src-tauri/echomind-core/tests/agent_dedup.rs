//! `create_thought` built-in tool dedupes within a 30s window.
//!
//! Pins the idempotency guard at `builtin_tools.rs` so an agent retry loop
//! (or a flaky model that re-emits the same tool_call) can't silently
//! produce a duplicate of the freshly-created note. The guard checks the
//! latest thought; if its content + timestamp match, the tool returns the
//! existing id with `deduped: true` instead of inserting again.

mod common;

use common::make_test_core;
use echomind_core::agent::builtin_tools::default_registry;
use serde_json::{json, Value};

#[tokio::test]
async fn create_thought_dedupes_repeated_calls_within_window() {
    let (_dir, core) = make_test_core();
    let reg = default_registry();
    let tool = reg
        .get("create_thought")
        .expect("create_thought tool must be registered");

    // First call — fresh content, gets a new id.
    let first_raw = (tool.handler)(&core, json!({"content": "测试灵感"}))
        .await
        .expect("first call ok");
    let first: Value = serde_json::from_str(&first_raw).unwrap();
    let first_id = first["id"].as_str().expect("first id").to_string();
    assert!(first["deduped"].is_null(), "first call must NOT be marked deduped");

    // Second call — identical content within 30s, must return the same id
    // with deduped: true, NOT create a new row.
    let second_raw = (tool.handler)(&core, json!({"content": "测试灵感"}))
        .await
        .expect("second call ok");
    let second: Value = serde_json::from_str(&second_raw).unwrap();
    assert_eq!(
        second["id"].as_str(),
        Some(first_id.as_str()),
        "deduped call must return the original thought's id"
    );
    assert_eq!(
        second["deduped"].as_bool(),
        Some(true),
        "second call must be flagged as deduped"
    );

    // DB invariant: still only one thought row.
    let all = core.list_all_thoughts().unwrap();
    assert_eq!(all.len(), 1, "DB must contain exactly one thought, not a duplicate");
}

#[tokio::test]
async fn create_thought_does_not_dedupe_different_content() {
    let (_dir, core) = make_test_core();
    let reg = default_registry();
    let tool = reg.get("create_thought").unwrap();

    (tool.handler)(&core, json!({"content": "灵感 A"}))
        .await
        .unwrap();
    (tool.handler)(&core, json!({"content": "灵感 B"}))
        .await
        .unwrap();

    let all = core.list_all_thoughts().unwrap();
    assert_eq!(all.len(), 2, "different content must produce two rows");
}

#[tokio::test]
async fn create_thought_trims_match_before_comparing() {
    let (_dir, core) = make_test_core();
    let reg = default_registry();
    let tool = reg.get("create_thought").unwrap();

    (tool.handler)(&core, json!({"content": "trim me"}))
        .await
        .unwrap();
    // Trailing whitespace / newline should still hit the dedup branch —
    // copy-paste from chat often appends \n and we don't want a duplicate
    // just for that.
    let raw = (tool.handler)(&core, json!({"content": "  trim me  \n"}))
        .await
        .unwrap();
    let v: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(v["deduped"].as_bool(), Some(true));
    assert_eq!(core.list_all_thoughts().unwrap().len(), 1);
}
