//! Live transcription bridge: spawns the MLX Python transcriber and streams its
//! newline-delimited JSON stdout to the frontend over a Tauri IPC channel.
//!
//! Control is a temp file the Python process polls: writing "pause"/""/"stop"
//! suspends/resumes/finalizes capture. After a transcript is saved, the names the
//! user confirmed are persisted into the on-device voiceprint store via
//! `enroll_voices`, so the same people are auto-recognized in future meetings.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};

use tauri::ipc::Channel;

use super::voice_profiles::voices_enabled_in_settings;
use crate::bundled_resources::{python_interpreter, python_script};
use crate::offline_models::apply_offline_env;

const SCRIPT_FILE: &str = "transcribe_server.py";
const IMPORT_SCRIPT_FILE: &str = "import_source.py";
const VOICE_STORE_SCRIPT_FILE: &str = "voice_store.py";

/// Spawn a Python script and stream its newline-delimited JSON stdout to the
/// frontend over an IPC channel. Shared by live transcribe and source import.
fn spawn_json_stream(
    mut command: Command,
    on_event: Channel<serde_json::Value>,
) -> Result<(), String> {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start process: {e}"))?;
    let stdout = child.stdout.take().ok_or("process produced no stdout")?;
    let stderr = child.stderr.take();
    let stderr_events = on_event.clone();
    if let Some(stderr) = stderr {
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let msg = line.trim();
                if msg.is_empty() {
                    continue;
                }
                let _ = stderr_events.send(serde_json::json!({
                    "type": "status",
                    "msg": msg,
                }));
            }
        });
    }
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) {
                let _ = on_event.send(value);
            }
        }
        let _ = child.wait();
    });
    Ok(())
}

/// Convert a web page, YouTube video, or file into a markdown note. Streams
/// status/final/error events; the frontend saves the result into the vault.
#[tauri::command]
pub fn import_source(input: String, on_event: Channel<serde_json::Value>) -> Result<(), String> {
    let mut cmd = Command::new(python_interpreter());
    cmd.arg(python_script(IMPORT_SCRIPT_FILE)).arg(&input);
    apply_offline_env(&mut cmd);
    spawn_json_stream(cmd, on_event)
}

fn control_path() -> std::path::PathBuf {
    std::env::temp_dir().join("memoria_transcribe.ctl")
}

fn write_control(state: &[u8]) -> Result<(), String> {
    std::fs::write(control_path(), state).map_err(|e| format!("failed to write control: {e}"))
}

#[tauri::command]
pub fn start_live_transcribe(on_event: Channel<serde_json::Value>) -> Result<(), String> {
    let ctl = control_path();
    let _ = std::fs::remove_file(&ctl);

    let mut command = Command::new(python_interpreter());
    command.arg(python_script(SCRIPT_FILE)).arg("--control").arg(&ctl);
    if voices_enabled_in_settings() {
        command.arg("--remember-voices");
    }
    apply_offline_env(&mut command);
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start transcriber: {e}"))?;

    let stdout = child.stdout.take().ok_or("transcriber produced no stdout")?;
    let stderr = child.stderr.take();
    let stderr_events = on_event.clone();
    if let Some(stderr) = stderr {
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let msg = line.trim();
                if msg.is_empty() {
                    continue;
                }
                let _ = stderr_events.send(serde_json::json!({
                    "type": "status",
                    "msg": msg,
                }));
            }
        });
    }

    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) {
                let _ = on_event.send(value);
            }
        }
        let _ = child.wait();
    });

    Ok(())
}

#[tauri::command]
pub fn pause_live_transcribe() -> Result<(), String> {
    write_control(b"pause")
}

#[tauri::command]
pub fn resume_live_transcribe() -> Result<(), String> {
    write_control(b"")
}

#[tauri::command]
pub fn stop_live_transcribe() -> Result<(), String> {
    write_control(b"stop")
}

/// Session ids are short hex strings made by the transcriber; anything else is ignored.
fn is_session_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.chars().all(|c| c.is_ascii_hexdigit())
}

/// Runs `voice_store.py` (no model, no mlx: it returns in a moment).
fn run_voice_store(args: &[&str]) -> Result<(), String> {
    let status = Command::new(python_interpreter())
        .arg(python_script(VOICE_STORE_SCRIPT_FILE))
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("failed to update voice profiles: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("updating voice profiles failed".into())
    }
}

/// Finish a session after the transcript is saved. Only the speakers the user named are added to
/// the on-device voiceprint store (and only if voice profiles are on); every other embedding is
/// dropped and the session file is deleted, also when `labels` is empty or voice profiles are off.
#[tauri::command]
pub fn enroll_voices(session_id: String, labels: HashMap<String, String>) -> Result<(), String> {
    if !is_session_id(&session_id) {
        return Ok(());
    }
    if labels.is_empty() || !voices_enabled_in_settings() {
        return run_voice_store(&["discard", &session_id]);
    }
    let labels_json = serde_json::to_string(&labels).map_err(|e| e.to_string())?;
    run_voice_store(&["enroll", &session_id, "--labels", &labels_json])
}

/// The user closed the review panel without saving: forget the session's embeddings.
#[tauri::command]
pub fn discard_voice_session(session_id: String) -> Result<(), String> {
    if !is_session_id(&session_id) {
        return Ok(());
    }
    run_voice_store(&["discard", &session_id])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_hex_session_ids_are_accepted() {
        assert!(is_session_id("0123456789ab"));
        assert!(!is_session_id(""));
        assert!(!is_session_id("../../etc"));
        assert!(!is_session_id("--labels"));
        assert!(!is_session_id(&"a".repeat(33)));
    }
}
