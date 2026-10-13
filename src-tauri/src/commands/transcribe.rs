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

const PYTHON: &str = "/opt/homebrew/bin/python3.11";
const SCRIPT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/resources/python/transcribe_server.py");
const IMPORT_SCRIPT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/resources/python/import_source.py");

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
    let mut cmd = Command::new(PYTHON);
    cmd.arg(IMPORT_SCRIPT).arg(&input);
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

    let mut command = Command::new(PYTHON);
    command.arg(SCRIPT).arg("--control").arg(&ctl);
    if voices_enabled_in_settings() {
        command.arg("--remember-voices");
    }
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

/// Persist the user-confirmed speaker names for a finished session into the
/// on-device voiceprint store. Runs the Python enroll pass synchronously; it is
/// fast (no model load — it only merges already-computed embeddings).
#[tauri::command]
pub fn enroll_voices(session_id: String, labels: HashMap<String, String>) -> Result<(), String> {
    if session_id.is_empty() || !voices_enabled_in_settings() {
        return Ok(());
    }
    let labels_json = serde_json::to_string(&labels).map_err(|e| e.to_string())?;
    let status = Command::new(PYTHON)
        .arg(SCRIPT)
        .arg("--enroll-session")
        .arg(&session_id)
        .arg("--labels")
        .arg(&labels_json)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("failed to enroll voices: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("voice enrollment process failed".into())
    }
}
