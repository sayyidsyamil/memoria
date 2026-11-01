use super::*;
use std::fs;
use tempfile::TempDir;

fn vault_path(dir: &TempDir) -> String {
    dir.path().to_string_lossy().into_owned()
}

fn note_path(dir: &TempDir, name: &str) -> String {
    dir.path().join(name).to_string_lossy().into_owned()
}

fn create_initialized_vault() -> (TempDir, String) {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("note.md"), "# Note\n").unwrap();
    let vault = vault_path(&dir);
    init_git_repo(vault.clone()).unwrap();
    (dir, vault)
}

#[tokio::test]
async fn desktop_git_commands_route_to_git_backend() {
    let (dir, vault) = create_initialized_vault();
    let note = note_path(&dir, "note.md");

    assert!(is_git_repo(vault.clone()).await);

    fs::write(dir.path().join("note.md"), "# Updated\n").unwrap();
    let modified = get_modified_files(vault.clone(), None).await.unwrap();
    assert!(modified.iter().any(|file| file.relative_path == "note.md"));

    let detailed = get_modified_files(vault.clone(), Some(true)).await.unwrap();
    assert!(detailed.iter().any(|file| file.relative_path == "note.md"));

    let diff = get_file_diff(vault.clone(), note.clone()).await.unwrap();
    assert!(diff.contains("# Updated"));

    git_commit(vault.clone(), "Update note".to_string())
        .await
        .unwrap();
    let history = get_file_history(vault.clone(), note.clone()).await.unwrap();
    assert!(history.iter().any(|commit| commit.message == "Update note"));

    let last_commit = get_last_commit_info(vault.clone()).await.unwrap().unwrap();
    assert!(!last_commit.short_hash.is_empty());

    let commit_diff = get_file_diff_at_commit(
        vault.clone(),
        note.clone(),
        history.first().unwrap().hash.clone(),
    )
    .await
    .unwrap();
    assert!(commit_diff.contains("# Updated"));

    let pulse = get_vault_pulse(vault.clone(), Some(5), Some(0))
        .await
        .unwrap();
    assert!(!pulse.is_empty());

    fs::write(dir.path().join("note.md"), "# Discard me\n").unwrap();
    git_discard_file(vault.clone(), "note.md".to_string())
        .await
        .unwrap();
    assert_eq!(
        fs::read_to_string(dir.path().join("note.md")).unwrap(),
        "# Updated\n"
    );

    assert!(get_conflict_files(vault.clone()).await.unwrap().is_empty());
    assert_eq!(get_conflict_mode(vault.clone()).await.unwrap(), "none");
    assert!(
        git_resolve_conflict(vault.clone(), "note.md".to_string(), "invalid".to_string())
            .await
            .is_err()
    );
}

#[test]
fn init_git_repo_rejects_broad_personal_folders() {
    let dir = TempDir::new().unwrap();
    let documents = dir.path().join("Documents");
    fs::create_dir_all(&documents).unwrap();
    fs::write(documents.join("unrelated.txt"), "not a vault").unwrap();

    let err = init_git_repo(documents.to_string_lossy().into_owned())
        .expect_err("expected Documents itself to be rejected before git init");

    assert!(err.contains("dedicated vault folder"));
    assert!(!documents.join(".git").exists());
}

#[tokio::test]
async fn init_git_repo_allows_named_vault_subfolder_under_documents() {
    let dir = TempDir::new().unwrap();
    let vault = dir.path().join("Documents").join("Memoria");
    fs::create_dir_all(&vault).unwrap();
    fs::write(vault.join("note.md"), "# Note\n").unwrap();
    let vault = vault.to_string_lossy().into_owned();

    init_git_repo(vault.clone()).unwrap();

    assert!(is_git_repo(vault).await);
}

#[tokio::test]
async fn is_git_repo_accepts_vault_nested_inside_parent_worktree() {
    let parent = TempDir::new().unwrap();
    fs::write(parent.path().join("README.md"), "# Parent\n").unwrap();
    crate::git::init_repo(parent.path()).unwrap();

    let nested_vault = parent.path().join("demo-vault-v2");
    fs::create_dir_all(&nested_vault).unwrap();
    fs::write(nested_vault.join("note.md"), "# Nested\n").unwrap();

    assert!(is_git_repo(nested_vault.to_string_lossy().into_owned()).await);
    assert!(!nested_vault.join(".git").exists());
}

#[test]
fn init_git_repo_rejects_nested_worktree_vault_without_direct_git_metadata() {
    let parent = TempDir::new().unwrap();
    fs::write(parent.path().join("README.md"), "# Parent\n").unwrap();
    crate::git::init_repo(parent.path()).unwrap();

    let nested_vault = parent.path().join("demo-vault-v2");
    fs::create_dir_all(&nested_vault).unwrap();
    fs::write(nested_vault.join("note.md"), "# Nested\n").unwrap();

    let err = init_git_repo(nested_vault.to_string_lossy().into_owned())
        .expect_err("expected nested vault to reuse the parent worktree");

    assert!(err.contains("inside a Git work tree"));
    assert!(!nested_vault.join(".git").exists());
}

#[tokio::test]
async fn desktop_remote_commands_report_no_remote() {
    let (_dir, vault) = create_initialized_vault();

    let pull = git_pull(vault.clone()).await.unwrap();
    assert_eq!(pull.status, "no_remote");

    let push = git_push(vault.clone()).await.unwrap();
    assert_eq!(push.status, "no_remote");

    let status = git_remote_status(vault.clone()).await.unwrap();
    assert!(!status.has_remote);
    assert_eq!((status.ahead, status.behind), (0, 0));
}

#[tokio::test]
async fn desktop_remote_commands_report_no_remote_for_gitless_vault() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("note.md"), "# Note\n").unwrap();
    let vault = vault_path(&dir);

    let pull = git_pull(vault.clone()).await.unwrap();
    assert_eq!(pull.status, "no_remote");
    assert!(pull.updated_files.is_empty());
    assert!(pull.conflict_files.is_empty());

    let push = git_push(vault.clone()).await.unwrap();
    assert_eq!(push.status, "no_remote");

    let status = git_remote_status(vault).await.unwrap();
    assert!(!status.has_remote);
    assert_eq!(status.branch, "");
    assert_eq!((status.ahead, status.behind), (0, 0));
}

#[tokio::test]
async fn desktop_git_metadata_commands_preserve_backend_results() {
    let (dir, vault) = create_initialized_vault();
    let workspace = git_workspace_info(vault.clone()).await.unwrap();
    // macOS temp dirs resolve through /private, so compare canonical paths.
    let canonical = |p: &str| fs::canonicalize(p).unwrap();
    assert_eq!(
        workspace.git_root.as_deref().map(canonical),
        Some(canonical(&vault))
    );
    assert_eq!(workspace.git_root_relation, "vault");

    let author = git_author_identity(vault.clone()).await.unwrap();
    assert!(!author.name.is_empty());
    assert!(!author.email.is_empty());
    assert_eq!(
        git_file_url(vault.clone(), note_path(&dir, "note.md"))
            .await
            .unwrap(),
        None
    );
    assert!(git_commit_conflict_resolution(vault).await.is_err());
}

#[tokio::test]
async fn desktop_provider_commands_return_native_git_capabilities() {
    let status = git_provider_status().await.unwrap();
    assert_eq!(status.native.provider, "native");
    assert!(status.native.available);
    let probe = test_git_provider("native".to_string(), None, None)
        .await
        .unwrap();
    assert_eq!(probe.provider, "native");
    assert!(probe.available);
    assert!(probe.version.unwrap().starts_with("git version"));
}

#[tokio::test(flavor = "current_thread")]
async fn blocking_git_operation_reports_worker_panics() {
    let error = run_vault_git_operation("/unused".to_string(), |_| panic!("worker failure"))
        .await
        .unwrap_err();
    assert!(error.contains("worker failure"));
}

#[test]
fn init_git_repo_rejects_missing_paths_and_files() {
    let dir = TempDir::new().unwrap();
    let missing = dir.path().join("missing").to_string_lossy().into_owned();
    assert!(init_git_repo(missing)
        .unwrap_err()
        .contains("existing vault folder"));
    let file = dir.path().join("note.md");
    fs::write(&file, "# Note\n").unwrap();
    assert!(init_git_repo(file.to_string_lossy().into_owned())
        .unwrap_err()
        .contains("Choose a folder"));
}
