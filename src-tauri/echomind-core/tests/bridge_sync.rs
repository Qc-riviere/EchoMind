//! `BridgeClient` JWT sliding-TTL refresh and 401 surfacing.
//!
//! Pins the v0.3.5 sliding-TTL fix (commit c775da0): every successful authed
//! call may carry `x-refresh-token` in the response headers, the client
//! captures it into its slot, and `take_refreshed_token` drains it so the
//! caller can persist the new token back to settings.
//!
//! NOT covered yet — the "5-min backoff after 401 / error dedup" lives in
//! the desktop-side sync_pull loop wrapper (above this layer); testing it
//! needs the loop refactored to take an injected clock + retry policy.
//! Tracked as a follow-up in TODO.md.

use echomind_core::bridge::client::{BridgeClient, SubsetThoughtPayload};
use serde_json::json;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const INITIAL_TOKEN: &str = "old.jwt.token";
const REFRESHED_TOKEN: &str = "fresh.jwt.token";

fn sample_payload() -> SubsetThoughtPayload {
    SubsetThoughtPayload {
        id: "thought-1".into(),
        content: "hi".into(),
        created_at: "2026-05-29T00:00:00Z".into(),
        updated_at: "2026-05-29T00:00:00Z".into(),
        tags: None,
        domain: None,
        embedding: None,
    }
}

#[tokio::test]
async fn successful_call_captures_x_refresh_token_into_slot() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/bridge/thoughts/upsert"))
        .and(header("authorization", &*format!("Bearer {}", INITIAL_TOKEN)))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("x-refresh-token", REFRESHED_TOKEN)
                .set_body_json(json!({"accepted": 1})),
        )
        .mount(&server)
        .await;

    let client = BridgeClient::new(server.uri(), Some(INITIAL_TOKEN.to_string()));
    let accepted = client
        .upsert_thoughts(&[sample_payload()])
        .await
        .expect("upsert ok");
    assert_eq!(accepted, 1);

    // Slot drained → persists, slot empty → no double-write next time.
    let drained = client.take_refreshed_token();
    assert_eq!(drained.as_deref(), Some(REFRESHED_TOKEN));
    assert!(
        client.take_refreshed_token().is_none(),
        "draining twice must yield None — caller has it now"
    );
}

#[tokio::test]
async fn no_header_means_no_refresh_taken() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/bridge/thoughts/upsert"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"accepted": 1})))
        .mount(&server)
        .await;

    let client = BridgeClient::new(server.uri(), Some(INITIAL_TOKEN.to_string()));
    client
        .upsert_thoughts(&[sample_payload()])
        .await
        .expect("upsert ok");

    assert!(client.take_refreshed_token().is_none());
}

#[tokio::test]
async fn echoed_same_token_does_not_dirty_the_slot() {
    // If server happens to echo the *current* token back, the client must
    // not flag it as a refresh — saves a no-op DB write.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/bridge/thoughts/upsert"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("x-refresh-token", INITIAL_TOKEN)
                .set_body_json(json!({"accepted": 1})),
        )
        .mount(&server)
        .await;

    let client = BridgeClient::new(server.uri(), Some(INITIAL_TOKEN.to_string()));
    client
        .upsert_thoughts(&[sample_payload()])
        .await
        .expect("upsert ok");
    assert!(client.take_refreshed_token().is_none());
}

#[tokio::test]
async fn auth_401_surfaces_error_to_caller() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/bridge/thoughts/upsert"))
        .respond_with(ResponseTemplate::new(401).set_body_string("unauthorized"))
        .mount(&server)
        .await;

    let client = BridgeClient::new(server.uri(), Some("expired.jwt".to_string()));
    let result = client.upsert_thoughts(&[sample_payload()]).await;
    assert!(result.is_err(), "401 must propagate as Err for caller backoff");
    let msg = result.unwrap_err();
    assert!(
        msg.contains("401") || msg.to_lowercase().contains("unauthorized"),
        "error message should mention the 401 / unauthorized cause — got {msg}",
    );
}

#[tokio::test]
async fn unpaired_client_refuses_to_send_authed_request() {
    let server = MockServer::start().await;
    // Mount no handlers — we should fail before hitting the network.
    let client = BridgeClient::new(server.uri(), None);
    let result = client.upsert_thoughts(&[sample_payload()]).await;
    assert!(result.is_err());
    let msg = result.unwrap_err();
    assert!(
        msg.contains("not paired") || msg.contains("no token"),
        "error must explain missing token — got {msg}",
    );
}
