//! Live transcription bridge: spawns the MLX Python transcriber and streams its
//! newline-delimited JSON stdout to the frontend over a Tauri IPC channel.
//!
//! Control is a temp file: `stop_live_transcribe` writes "stop" into it and the
//! Python process polls it, finalizes the diarized transcript, then exits.

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};

use tauri::ipc::Channel;

const PYTHON: &str = "/opt/homebrew/bin/python3.11";
const SCRIPT: &str = "/Users/sayyid/Documents/playground/transcribe_server.py";

fn control_path() -> std::path::PathBuf {
    std::env::temp_dir().join("memoria_transcribe.ctl")
}

#[tauri::command]
pub fn start_live_transcribe(on_event: Channel<serde_json::Value>) -> Result<(), String> {
    let ctl = control_path();
    let _ = std::fs::remove_file(&ctl);

    let mut child = Command::new(PYTHON)
        .arg(SCRIPT)
        .arg("--control")
        .arg(&ctl)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to start transcriber: {e}"))?;

    let stdout = child.stdout.take().ok_or("transcriber produced no stdout")?;

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
pub fn stop_live_transcribe() -> Result<(), String> {
    std::fs::write(control_path(), b"stop").map_err(|e| format!("failed to signal stop: {e}"))
}
