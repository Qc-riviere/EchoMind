//! N2 thread/follow-up regression net.
//!
//! Pins the parent_id schema + cascade rules + tree queries (Phase 1 of N2,
//! commit d2ac703) so future schema changes can't silently break thread
//! semantics. Specifically guards:
//!   - `list_thoughts` (the UI surface) returns roots ONLY
//!   - `list_all_thoughts` (sync / search / embedding) returns the full corpus
//!   - `append_to_thought` writes a child whose parent_id points at the parent
//!   - Deleting a root cascades through arbitrary tree depth
//!   - Deleting a mid-tree child cascades the subtree but spares the root + siblings

mod common;

use common::make_test_core;

#[test]
fn list_thoughts_returns_roots_only_children_via_list_children() {
    let (_dir, core) = make_test_core();

    let root = core.create_thought("root note").unwrap();
    let _c1 = core.append_to_thought(&root.id, "child 1").unwrap();
    let _c2 = core.append_to_thought(&root.id, "child 2").unwrap();

    let roots = core.list_thoughts().unwrap();
    assert_eq!(roots.len(), 1, "list_thoughts must hide children — got {:?}", roots);
    assert_eq!(roots[0].id, root.id);

    let children = core.list_thought_children(&root.id).unwrap();
    assert_eq!(children.len(), 2);
    // Children are ordered by created_at ASC so the visual stack reads top-to-bottom.
    assert!(children[0].created_at <= children[1].created_at);
}

#[test]
fn list_all_thoughts_includes_children_for_sync_and_search() {
    let (_dir, core) = make_test_core();
    let root = core.create_thought("root").unwrap();
    core.append_to_thought(&root.id, "child a").unwrap();
    core.append_to_thought(&root.id, "child b").unwrap();

    let all = core.list_all_thoughts().unwrap();
    assert_eq!(all.len(), 3, "list_all_thoughts must include children for sync");
}

#[test]
fn append_sets_parent_id_correctly() {
    let (_dir, core) = make_test_core();
    let root = core.create_thought("root").unwrap();
    let child = core.append_to_thought(&root.id, "child").unwrap();

    assert_eq!(child.parent_id.as_deref(), Some(root.id.as_str()));
    assert!(root.parent_id.is_none(), "root must have parent_id NULL");
}

#[test]
fn find_root_walks_up_arbitrary_depth() {
    let (_dir, core) = make_test_core();
    let root = core.create_thought("root").unwrap();
    let l1 = core.append_to_thought(&root.id, "l1").unwrap();
    let l2 = core.append_to_thought(&l1.id, "l2").unwrap();
    let l3 = core.append_to_thought(&l2.id, "l3").unwrap();

    assert_eq!(core.find_root_thought(&l3.id).unwrap().id, root.id);
    assert_eq!(core.find_root_thought(&l2.id).unwrap().id, root.id);
    assert_eq!(core.find_root_thought(&root.id).unwrap().id, root.id);
}

#[test]
fn list_descendants_returns_entire_subtree() {
    let (_dir, core) = make_test_core();
    let root = core.create_thought("root").unwrap();
    let l1a = core.append_to_thought(&root.id, "l1a").unwrap();
    let l1b = core.append_to_thought(&root.id, "l1b").unwrap();
    let _l2 = core.append_to_thought(&l1a.id, "l2 under l1a").unwrap();

    let desc = core.list_thought_descendants(&root.id).unwrap();
    let ids: Vec<&str> = desc.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(desc.len(), 3);
    assert!(ids.contains(&l1a.id.as_str()));
    assert!(ids.contains(&l1b.id.as_str()));
}

/// Deleting a root must remove every descendant — SQLite ALTER TABLE can't
/// add ON DELETE CASCADE, so this is enforced in app code via recursive CTE.
/// If anyone "simplifies" delete_thought back to a single-row DELETE this
/// test fires.
#[test]
fn deleting_root_cascades_entire_subtree() {
    let (_dir, core) = make_test_core();
    let root = core.create_thought("root").unwrap();
    let l1 = core.append_to_thought(&root.id, "l1").unwrap();
    let _l2 = core.append_to_thought(&l1.id, "l2").unwrap();
    let _l3 = core.append_to_thought(&l1.id, "another l2").unwrap();
    let other_root = core.create_thought("untouched sibling").unwrap();

    core.delete_thought(&root.id).unwrap();

    // Subtree gone.
    let all = core.list_all_thoughts().unwrap();
    assert_eq!(all.len(), 1, "only the sibling root should survive");
    assert_eq!(all[0].id, other_root.id);
}

#[test]
fn deleting_middle_node_keeps_root_and_siblings() {
    let (_dir, core) = make_test_core();
    let root = core.create_thought("root").unwrap();
    let l1a = core.append_to_thought(&root.id, "l1a").unwrap();
    let l1b = core.append_to_thought(&root.id, "l1b").unwrap();
    let _l2 = core.append_to_thought(&l1a.id, "l2 under l1a").unwrap();

    core.delete_thought(&l1a.id).unwrap();

    let all = core.list_all_thoughts().unwrap();
    let ids: Vec<&str> = all.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(all.len(), 2);
    assert!(ids.contains(&root.id.as_str()));
    assert!(ids.contains(&l1b.id.as_str()));
}

#[test]
fn list_home_thoughts_only_shows_roots() {
    let (_dir, core) = make_test_core();
    let r1 = core.create_thought("root 1").unwrap();
    let _ = core.create_thought("root 2").unwrap();
    core.append_to_thought(&r1.id, "child").unwrap();

    let home = core.list_home_thoughts().unwrap();
    let ids: Vec<&str> = home.recent.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(home.recent.len(), 2, "home must hide children");
    // The child must NOT appear.
    assert!(!ids.iter().any(|i| home
        .recent
        .iter()
        .any(|t| t.id == *i && t.parent_id.is_some())));
}
