//! N3 multi-pin regression net.
//!
//! Guards the pin data-model behaviour so future schema/sort changes can't
//! silently break it:
//!   - At most MAX_PINNED (5) thoughts can be pinned; the 6th errors with PIN_LIMIT
//!   - A fresh pin lands at the top of the list (newest-first default order)
//!   - Unpinning frees a slot and removes the thought from the pinned set
//!   - Manual reorder is persisted and reflected by list_home_thoughts

mod common;

use common::make_test_core;

#[test]
fn pinning_is_capped_at_five() {
    let (_dir, core) = make_test_core();
    let mut ids = Vec::new();
    for i in 0..6 {
        ids.push(core.create_thought(&format!("note {i}")).unwrap().id);
    }

    // First five pin fine.
    for id in ids.iter().take(5) {
        core.set_pinned(id, true).unwrap();
    }
    assert_eq!(core.list_home_thoughts().unwrap().pinned.len(), 5);

    // Sixth is rejected with the PIN_LIMIT marker (used by the UI to toast).
    let err = core.set_pinned(&ids[5], true).unwrap_err();
    assert!(err.contains("PIN_LIMIT"), "expected PIN_LIMIT, got: {err}");
    assert_eq!(core.list_home_thoughts().unwrap().pinned.len(), 5);
}

#[test]
fn fresh_pin_lands_on_top() {
    let (_dir, core) = make_test_core();
    let a = core.create_thought("a").unwrap().id;
    let b = core.create_thought("b").unwrap().id;

    core.set_pinned(&a, true).unwrap();
    core.set_pinned(&b, true).unwrap();

    let pinned = core.list_home_thoughts().unwrap().pinned;
    assert_eq!(pinned.len(), 2);
    assert_eq!(pinned[0].id, b, "most recently pinned should be first");
    assert_eq!(pinned[1].id, a);
}

#[test]
fn unpinning_frees_a_slot() {
    let (_dir, core) = make_test_core();
    let a = core.create_thought("a").unwrap().id;
    core.set_pinned(&a, true).unwrap();
    assert_eq!(core.list_home_thoughts().unwrap().pinned.len(), 1);

    core.set_pinned(&a, false).unwrap();
    assert!(core.list_home_thoughts().unwrap().pinned.is_empty());
    // Re-pin works after unpin.
    core.set_pinned(&a, true).unwrap();
    assert_eq!(core.list_home_thoughts().unwrap().pinned.len(), 1);
}

#[test]
fn manual_reorder_is_persisted() {
    let (_dir, core) = make_test_core();
    let a = core.create_thought("a").unwrap().id;
    let b = core.create_thought("b").unwrap().id;
    let c = core.create_thought("c").unwrap().id;
    for id in [&a, &b, &c] {
        core.set_pinned(id, true).unwrap();
    }

    // Drag c to the top, then a, then b.
    core.reorder_pinned(&[c.clone(), a.clone(), b.clone()]).unwrap();

    let pinned = core.list_home_thoughts().unwrap().pinned;
    let order: Vec<&str> = pinned.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(order, vec![c.as_str(), a.as_str(), b.as_str()]);
}
