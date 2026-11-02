//! Shared, developer-provisioned offline runtimes. Markers are written only after
//! installation and import/snapshot verification; an interrupted install is ignored.
use std::path::{Path, PathBuf};
use std::process::Command;

const SHARED: &str = "/Users/Shared/Memoria";

fn cache_required(home: &Path) -> Vec<PathBuf> {
    #[derive(serde::Deserialize)]
    struct Snapshot {
        repo: String,
        revision: String,
        files: std::collections::HashMap<String, u64>,
    }
    let snapshots: Vec<Snapshot> =
        serde_json::from_str(include_str!("../../../scripts/runtime/models.json"))
            .expect("checked-in model snapshot manifest");
    let mut required = vec![home.join(".memoria-complete")];
    for snapshot in snapshots {
        let repo = home
            .join("hub")
            .join(format!("models--{}", snapshot.repo.replace('/', "--")));
        required.push(repo.join("refs/main"));
        let root = repo.join("snapshots").join(snapshot.revision);
        required.extend(snapshot.files.keys().map(|file| root.join(file)));
    }
    required
}

fn resolve(
    explicit: Option<PathBuf>,
    shared: &Path,
    required: &[PathBuf],
    fallback: Option<PathBuf>,
    exists: impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
    explicit.or_else(|| {
        if required.iter().all(|path| exists(path)) {
            Some(shared.to_path_buf())
        } else {
            fallback
        }
    })
}

fn runtime_paths(kind: &str, shared: &Path, manifest: &Path) -> (&'static str, PathBuf, PathBuf) {
    let (variable, runtime, fallback) = match kind {
        "speech" => (
            "MEMORIA_SPEECH_PYTHON",
            "speech",
            manifest.join("../.speech-runtime/bin/python"),
        ),
        "embed" => (
            "MEMORIA_EMBED_PYTHON",
            "embed",
            manifest.join("../.embed-runtime/bin/python"),
        ),
        // The speech lock includes mlx-lm and all memory-engine dependencies.
        _ => (
            "MEMORIA_MEMORY_PYTHON",
            "speech",
            PathBuf::from("/opt/homebrew/bin/python3.11"),
        ),
    };
    (variable, shared.join("runtime").join(runtime), fallback)
}

pub(super) fn python(kind: &str) -> PathBuf {
    let (variable, base, fallback) = runtime_paths(
        kind,
        Path::new(SHARED),
        Path::new(env!("CARGO_MANIFEST_DIR")),
    );
    let interpreter = base.join("bin/python");
    resolve(
        std::env::var_os(variable).map(PathBuf::from),
        &interpreter,
        &[
            base.join(".memoria-complete"),
            base.join("pyvenv.cfg"),
            interpreter.clone(),
        ],
        Some(fallback),
        Path::is_file,
    )
    .expect("runtime always has a developer fallback")
}

pub(super) fn configure(command: &mut Command) {
    let home = Path::new(SHARED).join("hf");
    let explicit = std::env::var_os("MEMORIA_HF_HOME")
        .or_else(|| std::env::var_os("HF_HOME"))
        .map(PathBuf::from);
    // No shared install: leave the current user's default HF cache untouched.
    if let Some(home) = resolve(explicit, &home, &cache_required(&home), None, Path::is_file) {
        command.env("HF_HOME", &home);
        // HF_HOME also defaults Transformers' generated-code cache into the
        // shared tree. That tree is read-only for a clean account: keep derived
        // caches private/writable without duplicating any model snapshots.
        if home == Path::new(SHARED).join("hf") {
            if let Some(user_home) = dirs::home_dir() {
                configure_writable_caches(command, &user_home, |name| {
                    std::env::var_os(name).is_some()
                });
            }
        }
        // HF_HUB_CACHE takes precedence over HF_HOME in huggingface_hub.
        // Preserve an explicit hub-cache override, otherwise keep all workers aligned.
        if std::env::var_os("HF_HUB_CACHE").is_none()
            && std::env::var_os("HUGGINGFACE_HUB_CACHE").is_none()
        {
            command.env("HF_HUB_CACHE", home.join("hub"));
            command.env("HUGGINGFACE_HUB_CACHE", home.join("hub"));
        }
    }
    let embed = python("embed");
    if std::env::var_os("MEMORIA_EMBED_PYTHON").is_some() || embed.is_file() {
        command.env("MEMORIA_EMBED_PYTHON", embed);
    }
    command
        .env("HF_HUB_OFFLINE", "1")
        .env("TRANSFORMERS_OFFLINE", "1");
}

fn configure_writable_caches(
    command: &mut Command,
    user_home: &Path,
    explicit: impl Fn(&str) -> bool,
) {
    for (variable, directory) in [
        ("HF_MODULES_CACHE", "modules"),
        ("HF_ASSETS_CACHE", "assets"),
        ("HF_XET_CACHE", "xet"),
    ] {
        if !explicit(variable) {
            command.env(
                variable,
                user_home.join(".cache/huggingface").join(directory),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_snapshots_keep_generated_caches_in_the_current_account() {
        let mut command = Command::new("unused");
        configure_writable_caches(&mut command, Path::new("/clean-user"), |_| false);
        let envs: std::collections::HashMap<_, _> = command.get_envs().collect();
        for (variable, directory) in [
            ("HF_MODULES_CACHE", "modules"),
            ("HF_ASSETS_CACHE", "assets"),
            ("HF_XET_CACHE", "xet"),
        ] {
            assert_eq!(
                envs.get(std::ffi::OsStr::new(variable)).copied().flatten(),
                Some(
                    Path::new("/clean-user/.cache/huggingface")
                        .join(directory)
                        .as_os_str()
                )
            );
        }
        let mut explicit = Command::new("unused");
        configure_writable_caches(&mut explicit, Path::new("/clean-user"), |_| true);
        assert_eq!(explicit.get_envs().count(), 0);
    }

    #[test]
    fn speech_embed_memory_and_qwen_use_their_own_override_and_fallback() {
        for (kind, variable, runtime, fallback) in [
            (
                "speech",
                "MEMORIA_SPEECH_PYTHON",
                "speech",
                "/dev/src-tauri/../.speech-runtime/bin/python",
            ),
            (
                "embed",
                "MEMORIA_EMBED_PYTHON",
                "embed",
                "/dev/src-tauri/../.embed-runtime/bin/python",
            ),
            (
                "memory",
                "MEMORIA_MEMORY_PYTHON",
                "speech",
                "/opt/homebrew/bin/python3.11",
            ),
            (
                "qwen",
                "MEMORIA_MEMORY_PYTHON",
                "speech",
                "/opt/homebrew/bin/python3.11",
            ),
        ] {
            let (actual_variable, base, actual_fallback) =
                runtime_paths(kind, Path::new("/shared"), Path::new("/dev/src-tauri"));
            assert_eq!(actual_variable, variable);
            assert_eq!(base, Path::new("/shared/runtime").join(runtime));
            assert_eq!(actual_fallback, PathBuf::from(fallback));
            let interpreter = base.join("bin/python");
            let required = [
                base.join(".memoria-complete"),
                base.join("pyvenv.cfg"),
                interpreter.clone(),
            ];
            assert_eq!(
                resolve(
                    None,
                    &interpreter,
                    &required,
                    Some(actual_fallback.clone()),
                    |_| true
                ),
                Some(interpreter.clone())
            );
            assert_eq!(
                resolve(
                    None,
                    &interpreter,
                    &required,
                    Some(actual_fallback.clone()),
                    |_| false
                ),
                Some(actual_fallback)
            );
            assert_eq!(
                resolve(
                    Some("/override".into()),
                    &interpreter,
                    &required,
                    None,
                    |_| true
                ),
                Some("/override".into())
            );
        }
    }

    #[test]
    fn explicit_runtime_or_cache_wins_even_if_missing() {
        let explicit = PathBuf::from("/explicit");
        assert_eq!(
            resolve(
                Some(explicit.clone()),
                Path::new("/shared"),
                &["/marker".into()],
                None,
                |_| panic!("explicit override must not inspect shared files")
            ),
            Some(explicit)
        );
    }

    #[test]
    fn complete_shared_runtime_precedes_developer_fallback() {
        let files = [
            "/shared/.memoria-complete".into(),
            "/shared/pyvenv.cfg".into(),
            "/shared/bin/python".into(),
        ];
        assert_eq!(
            resolve(
                None,
                Path::new("/shared/bin/python"),
                &files,
                Some("/dev/python".into()),
                |_| true
            ),
            Some("/shared/bin/python".into())
        );
        for missing in &files {
            assert_eq!(
                resolve(
                    None,
                    Path::new("/shared/bin/python"),
                    &files,
                    Some("/dev/python".into()),
                    |p| p != missing
                ),
                Some("/dev/python".into())
            );
        }
    }

    #[test]
    fn cache_requires_completion_marker_otherwise_preserves_user_default() {
        let home = Path::new("/shared/hf");
        let required = cache_required(home);
        assert!(required.len() > 10);
        assert_eq!(
            resolve(None, home, &required, None, |_| true),
            Some(home.into())
        );
        for missing in &required {
            assert_eq!(resolve(None, home, &required, None, |p| p != missing), None);
        }
    }
}
