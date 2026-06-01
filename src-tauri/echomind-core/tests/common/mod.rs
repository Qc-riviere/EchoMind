//! Shared helpers for integration tests.
//!
//! Each test gets a fresh isolated EchoMind instance backed by an on-disk
//! SQLite file inside a `TempDir`. The TempDir keeps the test hermetic and
//! cleans up on drop.

use echomind_core::EchoMind;
use tempfile::TempDir;

/// Build a fresh EchoMind with an isolated temp DB. Returns the TempDir so
/// callers can keep it alive for the test's duration — dropping it deletes
/// the underlying DB file.
pub fn make_test_core() -> (TempDir, EchoMind) {
    let dir = tempfile::tempdir().expect("create tempdir");
    let db_path = dir.path().join("echomind-test.db");
    let core = EchoMind::open(&db_path).expect("open EchoMind");
    (dir, core)
}
