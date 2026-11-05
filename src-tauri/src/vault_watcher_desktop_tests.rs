use std::collections::HashSet;

use notify::event::{AccessKind, CreateKind, EventAttributes, ModifyKind, RemoveKind};
use notify::{Event, EventKind};

use super::*;

fn event(kind: EventKind, paths: &[&str]) -> Event {
    Event {
        kind,
        paths: paths.iter().map(PathBuf::from).collect(),
        attrs: EventAttributes::default(),
    }
}

#[test]
fn validate_vault_path_accepts_existing_directories_only() {
    let dir = tempfile::TempDir::new().unwrap();

    assert_eq!(
        validate_vault_path(dir.path().to_path_buf()).unwrap(),
        dir.path()
    );
    assert_eq!(
        validate_vault_path(PathBuf::new()).unwrap_err(),
        "Vault path is required"
    );
    assert!(validate_vault_path(dir.path().join("missing"))
        .unwrap_err()
        .contains("Vault path is not a directory"));
}

#[test]
fn changed_paths_ignores_access_events() {
    let paths = changed_paths(
        event(EventKind::Access(AccessKind::Read), &["notes/today.md"]),
        None,
        &mut ContentFingerprints::default(),
    );

    assert!(paths.is_empty());
}

#[test]
fn changed_paths_filters_unwatchable_paths() {
    let paths = changed_paths(
        event(
            EventKind::Create(CreateKind::File),
            &[
                ".git/index.lock",
                "node_modules/pkg/index.js",
                "notes/today.md",
            ],
        ),
        None,
        &mut ContentFingerprints::default(),
    );

    assert_eq!(paths, vec!["notes/today.md"]);
}

#[test]
fn changed_paths_filters_editor_temporary_files() {
    let paths = changed_paths(
        event(
            EventKind::Create(CreateKind::File),
            &[
                ".DS_Store",
                ".memoria-rename-txn",
                ".#draft.md",
                "draft.md~",
                "draft.tmp",
                "draft.swp",
                "draft.swx",
                "notes/keep.md",
            ],
        ),
        None,
        &mut ContentFingerprints::default(),
    );

    assert_eq!(paths, vec!["notes/keep.md"]);
}

fn modify_any(path: &Path) -> Event {
    event(
        EventKind::Modify(ModifyKind::Any),
        &[path.to_str().unwrap()],
    )
}

#[test]
fn attribute_only_modifications_do_not_reach_the_frontend() {
    let dir = tempfile::TempDir::new().unwrap();
    let note = dir.path().join("note.md");
    std::fs::write(&note, "# Note\n").unwrap();
    let mut fingerprints = ContentFingerprints::default();

    let first = changed_paths(modify_any(&note), None, &mut fingerprints);
    let mut permissions = std::fs::metadata(&note).unwrap().permissions();
    permissions.set_readonly(true);
    std::fs::set_permissions(&note, permissions).unwrap();
    let attribute_only = changed_paths(modify_any(&note), None, &mut fingerprints);

    assert_eq!(first.len(), 1);
    assert!(attribute_only.is_empty());
}

#[test]
fn content_modifications_and_removals_still_reach_the_frontend() {
    let dir = tempfile::TempDir::new().unwrap();
    let note = dir.path().join("note.md");
    std::fs::write(&note, "# Note\n").unwrap();
    let mut fingerprints = ContentFingerprints::default();
    changed_paths(modify_any(&note), None, &mut fingerprints);

    std::fs::write(&note, "# Note\n\nEdited elsewhere\n").unwrap();
    let edited = changed_paths(modify_any(&note), None, &mut fingerprints);
    std::fs::remove_file(&note).unwrap();
    let removed = changed_paths(
        event(
            EventKind::Remove(RemoveKind::File),
            &[note.to_str().unwrap()],
        ),
        None,
        &mut fingerprints,
    );

    assert_eq!(edited.len(), 1);
    assert_eq!(removed.len(), 1);
}

#[test]
fn directory_modifications_are_left_to_their_children() {
    let dir = tempfile::TempDir::new().unwrap();
    let folder = dir.path().join("projects");
    std::fs::create_dir(&folder).unwrap();

    let paths = changed_paths(
        modify_any(&folder),
        None,
        &mut ContentFingerprints::default(),
    );

    assert!(paths.is_empty());
}

#[test]
fn watcher_owners_keep_shared_watch_alive_until_the_last_window_stops() {
    let mut owners = HashSet::new();

    register_watcher_owner(&mut owners, "main");
    register_watcher_owner(&mut owners, "note-1");

    assert!(!unregister_watcher_owner(&mut owners, "note-1"));
    assert!(owners.contains("main"));
    assert!(unregister_watcher_owner(&mut owners, "main"));
    assert!(owners.is_empty());
}
