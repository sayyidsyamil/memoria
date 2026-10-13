//! Where Memoria finds files shipped inside the app (starter vault, Python scripts)
//! and which Python interpreter runs them. Shared by the ledger bridge,
//! transcription/import and the starter-vault builder.

use std::path::{Path, PathBuf};

pub const DEFAULT_PYTHON: &str = "/opt/homebrew/bin/python3.11";

/// `MEMORIA_PYTHON` when set and not blank, otherwise the Homebrew Python 3.11.
pub fn python_interpreter() -> PathBuf {
    python_interpreter_from(std::env::var("MEMORIA_PYTHON").ok().as_deref())
}

fn python_interpreter_from(override_path: Option<&str>) -> PathBuf {
    match override_path.map(str::trim) {
        Some(path) if !path.is_empty() => PathBuf::from(path),
        _ => PathBuf::from(DEFAULT_PYTHON),
    }
}

/// Folders that may hold the bundled resource `name`, most specific first:
/// the packaged macOS app, a plain executable folder, then the source tree (development).
fn resource_candidates(current_exe: Option<&Path>, name: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(exe_dir) = current_exe.and_then(Path::parent) {
        if exe_dir.file_name().is_some_and(|dir| dir == "MacOS") {
            if let Some(contents) = exe_dir.parent() {
                candidates.push(contents.join("Resources").join(name));
            }
        }
        candidates.push(exe_dir.join(name));
        candidates.push(exe_dir.join("resources").join(name));
    }
    candidates.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("resources").join(name));
    candidates
}

fn first_with_marker(candidates: Vec<PathBuf>, marker: &str) -> Option<PathBuf> {
    candidates.into_iter().find(|dir| dir.join(marker).is_file())
}

/// The bundled folder `name` (e.g. `demo-vault`, `python`), recognised by containing `marker`.
pub fn bundled_resource_dir(name: &str, marker: &str) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok();
    first_with_marker(resource_candidates(exe.as_deref(), name), marker)
}

/// Full path of a bundled Python script, falling back to the source-tree path so the
/// error from Python (file not found) names the place that was tried.
pub fn python_script(file: &str) -> PathBuf {
    bundled_resource_dir("python", file)
        .map(|dir| dir.join(file))
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("resources").join("python").join(file))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn python_override_is_used_unless_blank() {
        assert_eq!(python_interpreter_from(None), PathBuf::from(DEFAULT_PYTHON));
        assert_eq!(python_interpreter_from(Some("  ")), PathBuf::from(DEFAULT_PYTHON));
        assert_eq!(python_interpreter_from(Some(" /usr/bin/python3 ")), PathBuf::from("/usr/bin/python3"));
    }

    #[test]
    fn packaged_macos_app_resources_come_before_the_source_tree() {
        let exe = Path::new("/Applications/Memoria.app/Contents/MacOS/memoria");
        let found = resource_candidates(Some(exe), "demo-vault");
        assert_eq!(found[0], Path::new("/Applications/Memoria.app/Contents/Resources/demo-vault"));
        assert!(found.last().unwrap().ends_with("resources/demo-vault"));
    }

    #[test]
    fn only_a_folder_containing_the_marker_is_accepted() {
        let dir = tempfile::tempdir().unwrap();
        let empty = dir.path().join("empty");
        let good = dir.path().join("good");
        fs::create_dir_all(&empty).unwrap();
        fs::create_dir_all(&good).unwrap();
        fs::write(good.join("welcome.md"), "x").unwrap();
        assert_eq!(first_with_marker(vec![empty, good.clone()], "welcome.md"), Some(good));
        assert_eq!(first_with_marker(vec![], "welcome.md"), None);
    }

    #[test]
    fn the_source_tree_has_the_bundled_python_scripts() {
        for script in ["transcribe_server.py", "import_source.py"] {
            assert!(python_script(script).is_file(), "{script} missing");
        }
    }
}
