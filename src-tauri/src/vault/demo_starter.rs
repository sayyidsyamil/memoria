//! Offline "Getting Started" source: the starter vault bundled inside the app,
//! turned into a throw-away local git repository so the normal clone flow can use it.

use std::fs;
use std::path::{Path, PathBuf};

use tempfile::TempDir;

/// Resource folder name, relative to the app's resources (and to `src-tauri/resources`).
pub const DEMO_VAULT_RESOURCE: &str = "demo-vault";
const DEMO_VAULT_MARKER: &str = "welcome.md";

/// A local git repo built from the bundled starter files; removed when dropped.
pub struct BundledStarterRepo {
    dir: TempDir,
}

impl BundledStarterRepo {
    pub fn path(&self) -> &Path {
        self.dir.path()
    }
}

/// Build the starter repo from the bundled files found next to the app (or in the source tree).
pub fn build_bundled_starter_repo() -> Result<BundledStarterRepo, String> {
    let source = crate::bundled_resources::bundled_resource_dir(DEMO_VAULT_RESOURCE, DEMO_VAULT_MARKER)
        .ok_or_else(|| {
            format!(
                "The bundled starter vault was not found. Expected a '{DEMO_VAULT_RESOURCE}' folder with {DEMO_VAULT_MARKER} inside the app resources."
            )
        })?;
    build_starter_repo_from(&source)
}

pub(crate) fn build_starter_repo_from(source: &Path) -> Result<BundledStarterRepo, String> {
    let dir = tempfile::Builder::new()
        .prefix("memoria-starter-")
        .tempdir()
        .map_err(|e| format!("Could not create a working folder for the starter vault: {e}"))?;
    copy_tree(source, dir.path())?;
    commit_all(dir.path())?;
    Ok(BundledStarterRepo { dir })
}

fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    let read = fs::read_dir(from).map_err(|e| format!("Cannot read '{}': {e}", from.display()))?;
    for entry in read {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let target: PathBuf = to.join(&name);
        if entry.path().is_dir() {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
            copy_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)
                .map_err(|e| format!("Cannot copy '{}': {e}", entry.path().display()))?;
        }
    }
    Ok(())
}

fn commit_all(repo: &Path) -> Result<(), String> {
    run_git(repo, &["init", "--quiet"])?;
    run_git(repo, &["add", "--all"])?;
    run_git(
        repo,
        &[
            "-c", "user.name=Memoria",
            "-c", "user.email=memoria@localhost",
            "-c", "commit.gpgsign=false",
            "commit", "--quiet", "-m", "Memoria starter vault",
        ],
    )
}

fn run_git(repo: &Path, args: &[&str]) -> Result<(), String> {
    let output = crate::hidden_command("git")
        .args(args)
        .current_dir(repo)
        .output()
        .map_err(|e| format!("Git is required to create the starter vault but could not be started: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    Err(format!(
        "git {} failed: {}",
        args.last().unwrap_or(&""),
        String::from_utf8_lossy(&output.stderr).trim()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// (engine demo file, note name in the bundled vault) — keep in sync with scripts/sync-demo-notes.sh.
    const DEMO_NOTES: [(&str, &str); 3] = [
        ("meeting_1.md", "Procurement pilot kick-off.md"),
        ("meeting_2.md", "Procurement pilot progress check.md"),
        ("meeting_3.md", "Procurement pilot pre-launch review.md"),
    ];

    fn bundled_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("resources").join(DEMO_VAULT_RESOURCE)
    }

    #[test]
    fn bundled_starter_builds_a_canonical_vault_with_the_three_meetings() {
        let repo = build_starter_repo_from(&bundled_dir()).unwrap();
        for file in ["type.md", "note.md", "welcome.md", "views/active-projects.yml"] {
            assert!(repo.path().join(file).is_file(), "{file} missing");
        }
        for (_, note) in DEMO_NOTES {
            let text = fs::read_to_string(repo.path().join(note)).unwrap();
            assert!(text.starts_with("---\ntype: Transcript\n"), "{note} is not a Transcript note");
        }

        let work = tempfile::tempdir().unwrap();
        let vault = work.path().join("Getting Started");
        super::super::getting_started::create_getting_started_vault_from_repo(
            &vault,
            &repo.path().to_string_lossy(),
        )
        .unwrap();
        assert!(super::super::getting_started::vault_exists_with_default_path(&vault, Some(&vault)));
        assert!(vault.join("Procurement pilot kick-off.md").is_file());
        assert!(vault.join("AGENTS.md").is_file());
        let remotes = crate::hidden_command("git").args(["remote"]).current_dir(&vault).output().unwrap();
        assert!(String::from_utf8_lossy(&remotes.stdout).trim().is_empty());
    }

    #[test]
    fn missing_source_folder_gives_a_readable_error() {
        let err = build_starter_repo_from(Path::new("/definitely/not/here")).err().unwrap();
        assert!(err.contains("/definitely/not/here"));
    }

    #[test]
    fn bundled_demo_notes_match_the_engine_copies() {
        let engine_demo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../engine/data/demo");
        if !engine_demo.is_dir() {
            eprintln!("SKIPPED: engine demo folder not found at {}", engine_demo.display());
            return;
        }
        for (source, note) in DEMO_NOTES {
            let engine = fs::read(engine_demo.join(source)).unwrap();
            let bundled = fs::read(bundled_dir().join(note)).unwrap();
            assert!(
                engine == bundled,
                "{note} differs from engine/data/demo/{source}; run scripts/sync-demo-notes.sh"
            );
        }
    }
}
