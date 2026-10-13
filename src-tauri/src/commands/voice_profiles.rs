//! Voice profiles are biometric data. They are only stored when the user opts in
//! (`remember_voices` setting), live in `~/.memoria` on this computer, and can be
//! deleted here at any time.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use crate::settings::Settings;

const VOICES_FILE: &str = "voices.json";
const SESSIONS_DIR: &str = "sessions";

/// Only an explicit opt-in counts; an unanswered setting means off.
pub fn voices_may_be_stored(settings: &Settings) -> bool {
    settings.remember_voices == Some(true)
}

pub fn voices_enabled_in_settings() -> bool {
    crate::settings::get_settings()
        .map(|settings| voices_may_be_stored(&settings))
        .unwrap_or(false)
}

fn memoria_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".memoria"))
        .ok_or_else(|| "Could not find your home folder.".to_string())
}

fn remove_if_present(result: std::io::Result<()>, removed: &mut usize) -> Result<(), String> {
    match result {
        Ok(()) => {
            *removed += 1;
            Ok(())
        }
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("Could not delete saved voice profiles: {err}")),
    }
}

/// Removes the voiceprint store and the pending per-session embeddings.
/// Returns how many items were deleted; deleting nothing is not an error.
pub fn delete_voice_profiles_in(dir: &Path) -> Result<usize, String> {
    let mut removed = 0;
    remove_if_present(fs::remove_file(dir.join(VOICES_FILE)), &mut removed)?;
    remove_if_present(fs::remove_dir_all(dir.join(SESSIONS_DIR)), &mut removed)?;
    Ok(removed)
}

#[tauri::command]
pub fn delete_voice_profiles() -> Result<usize, String> {
    delete_voice_profiles_in(&memoria_dir()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deletes_voice_store_and_sessions() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(VOICES_FILE), "{}").unwrap();
        fs::create_dir_all(dir.path().join(SESSIONS_DIR)).unwrap();
        fs::write(dir.path().join(SESSIONS_DIR).join("abc.json"), "{}").unwrap();
        fs::write(dir.path().join("other.txt"), "keep").unwrap();

        assert_eq!(delete_voice_profiles_in(dir.path()), Ok(2));
        assert!(!dir.path().join(VOICES_FILE).exists());
        assert!(!dir.path().join(SESSIONS_DIR).exists());
        assert!(dir.path().join("other.txt").exists());
    }

    #[test]
    fn deleting_nothing_is_fine_and_repeatable() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(delete_voice_profiles_in(dir.path()), Ok(0));
        assert_eq!(delete_voice_profiles_in(&dir.path().join("missing")), Ok(0));
    }

    #[test]
    fn only_an_explicit_opt_in_allows_storing() {
        let mut settings = Settings::default();
        assert!(!voices_may_be_stored(&settings));
        settings.remember_voices = Some(false);
        assert!(!voices_may_be_stored(&settings));
        settings.remember_voices = Some(true);
        assert!(voices_may_be_stored(&settings));
    }
}
