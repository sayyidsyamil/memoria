//! Tells the Python children to skip Hugging Face network checks once every model is on disk.
//!
//! `huggingface_hub` otherwise contacts huggingface.co each time a model is loaded, even when the
//! files are cached. When all four models Memoria uses are in the cache we set `HF_HUB_OFFLINE=1`
//! for the children; if any is missing nothing is set, so the first download still works.
//! `MEMORIA_ALLOW_NETWORK=1` always leaves the network allowed. Mirrors `scripts/memoria-doctor.sh`.

use std::path::{Path, PathBuf};
use std::process::Command;

/// The models the ledger service, live transcription and import load.
pub const REQUIRED_MODELS: [&str; 4] = [
    "mlx-community/Qwen3.5-4B-MLX-4bit",
    "mlx-community/parakeet-tdt-0.6b-v3",
    "mlx-community/diar_streaming_sortformer_4spk-v2.1-fp16",
    "mlx-community/wespeaker-voxceleb-resnet34-LM",
];

fn non_blank(value: Option<String>) -> Option<String> {
    value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

/// Same precedence as `huggingface_hub`: `HF_HUB_CACHE`, `HUGGINGFACE_HUB_CACHE`, `$HF_HOME/hub`,
/// then `~/.cache/huggingface/hub`.
fn hub_cache_dir(env: &dyn Fn(&str) -> Option<String>, home: Option<PathBuf>) -> PathBuf {
    if let Some(dir) = non_blank(env("HF_HUB_CACHE")).or_else(|| non_blank(env("HUGGINGFACE_HUB_CACHE"))) {
        return PathBuf::from(dir);
    }
    if let Some(dir) = non_blank(env("HF_HOME")) {
        return Path::new(&dir).join("hub");
    }
    home.unwrap_or_default().join(".cache").join("huggingface").join("hub")
}

fn model_is_cached(hub: &Path, model: &str) -> bool {
    let snapshots = hub.join(format!("models--{}", model.replace('/', "--"))).join("snapshots");
    std::fs::read_dir(snapshots).is_ok_and(|mut entries| entries.next().is_some())
}

fn all_models_cached(hub: &Path) -> bool {
    REQUIRED_MODELS.iter().all(|model| model_is_cached(hub, model))
}

fn network_forced(env: &dyn Fn(&str) -> Option<String>) -> bool {
    non_blank(env("MEMORIA_ALLOW_NETWORK")).is_some_and(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
}

fn should_go_offline(env: &dyn Fn(&str) -> Option<String>, home: Option<PathBuf>) -> bool {
    !network_forced(env) && all_models_cached(&hub_cache_dir(env, home))
}

/// True when the Python children should be started with `HF_HUB_OFFLINE=1`.
pub fn models_ready_offline() -> bool {
    should_go_offline(&|key| std::env::var(key).ok(), dirs::home_dir())
}

/// Adds `HF_HUB_OFFLINE=1` to a Python child when every model is already cached.
pub fn apply_offline_env(command: &mut Command) {
    if models_ready_offline() {
        command.env("HF_HUB_OFFLINE", "1");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::fs;

    fn env_of(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        move |key| map.get(key).cloned()
    }

    fn cache_model(hub: &Path, model: &str) {
        fs::create_dir_all(hub.join(format!("models--{}", model.replace('/', "--"))).join("snapshots").join("abc123")).unwrap();
    }

    fn full_cache(hub: &Path) {
        for model in REQUIRED_MODELS {
            cache_model(hub, model);
        }
    }

    #[test]
    fn default_cache_is_under_the_home_folder() {
        let hub = hub_cache_dir(&env_of(&[]), Some(PathBuf::from("/Users/a")));
        assert_eq!(hub, PathBuf::from("/Users/a/.cache/huggingface/hub"));
    }

    #[test]
    fn cache_variables_follow_the_hugging_face_precedence() {
        let home = Some(PathBuf::from("/Users/a"));
        assert_eq!(hub_cache_dir(&env_of(&[("HF_HOME", "/models")]), home.clone()), PathBuf::from("/models/hub"));
        assert_eq!(hub_cache_dir(&env_of(&[("HF_HOME", "/models"), ("HUGGINGFACE_HUB_CACHE", "/old")]), home.clone()), PathBuf::from("/old"));
        assert_eq!(hub_cache_dir(&env_of(&[("HF_HOME", "/models"), ("HUGGINGFACE_HUB_CACHE", "/old"), ("HF_HUB_CACHE", "/new")]), home.clone()), PathBuf::from("/new"));
        assert_eq!(hub_cache_dir(&env_of(&[("HF_HOME", "  ")]), home), PathBuf::from("/Users/a/.cache/huggingface/hub"));
    }

    #[test]
    fn a_complete_cache_means_offline() {
        let dir = tempfile::tempdir().unwrap();
        full_cache(dir.path());
        assert!(all_models_cached(dir.path()));
        assert!(should_go_offline(&env_of(&[("HF_HUB_CACHE", dir.path().to_str().unwrap())]), None));
    }

    #[test]
    fn a_partial_cache_keeps_the_network_allowed() {
        let dir = tempfile::tempdir().unwrap();
        for model in &REQUIRED_MODELS[..3] {
            cache_model(dir.path(), model);
        }
        assert!(!all_models_cached(dir.path()));
        assert!(!should_go_offline(&env_of(&[("HF_HUB_CACHE", dir.path().to_str().unwrap())]), None));
    }

    #[test]
    fn a_model_folder_without_a_snapshot_does_not_count() {
        let dir = tempfile::tempdir().unwrap();
        full_cache(dir.path());
        let broken = dir.path().join("models--mlx-community--parakeet-tdt-0.6b-v3").join("snapshots").join("abc123");
        fs::remove_dir(broken).unwrap();
        assert!(!all_models_cached(dir.path()));
    }

    #[test]
    fn an_empty_or_missing_cache_is_not_offline() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!all_models_cached(dir.path()));
        assert!(!all_models_cached(&dir.path().join("missing")));
    }

    #[test]
    fn hf_home_is_honoured_for_the_cache_location() {
        let dir = tempfile::tempdir().unwrap();
        full_cache(&dir.path().join("hub"));
        assert!(should_go_offline(&env_of(&[("HF_HOME", dir.path().to_str().unwrap())]), None));
    }

    #[test]
    fn allow_network_forces_offline_mode_off() {
        let dir = tempfile::tempdir().unwrap();
        full_cache(dir.path());
        let hub = dir.path().to_str().unwrap();
        assert!(!should_go_offline(&env_of(&[("HF_HUB_CACHE", hub), ("MEMORIA_ALLOW_NETWORK", "1")]), None));
        assert!(!should_go_offline(&env_of(&[("HF_HUB_CACHE", hub), ("MEMORIA_ALLOW_NETWORK", "true")]), None));
        assert!(should_go_offline(&env_of(&[("HF_HUB_CACHE", hub), ("MEMORIA_ALLOW_NETWORK", "0")]), None));
    }

    #[test]
    fn the_required_models_match_the_doctor_script() {
        let doctor = fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/memoria-doctor.sh")).unwrap();
        for model in REQUIRED_MODELS {
            assert!(doctor.contains(model), "{model} missing from memoria-doctor.sh");
        }
    }
}
