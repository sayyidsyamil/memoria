use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::{Arc, Mutex, OnceLock, atomic::{AtomicBool, AtomicU64, Ordering}};
use std::time::{Duration, Instant};
use base64::Engine;
use serde_json::{json, Value};
use tauri::{Emitter, Manager};

/// One helper frame: 1,600 little-endian float32 samples, 100 ms of 16 kHz mono audio.
const FRAME_BYTES: usize = 6400;
const HELPER: &str = "memoria-call-audio";
const LIMIT: Duration = Duration::from_secs(7200);
const EVENT: &str = "meeting-call-audio";

/// A helper started for a meeting session. `active` turns false once it is asked to stop; nothing it sends after that
/// reaches the meeting window.
struct Run { id: u64, active: Arc<AtomicBool> }
static RUNS: OnceLock<Mutex<HashMap<String, Run>>> = OnceLock::new();
static NEXT_RUN: AtomicU64 = AtomicU64::new(1);
fn runs() -> &'static Mutex<HashMap<String, Run>> { RUNS.get_or_init(Default::default) }

fn key(label: &str, id: &str) -> Result<String, String> {
    if label != "meeting-hud" { return Err("Call audio is owned by the meeting HUD".into()); }
    uuid::Uuid::parse_str(id).map_err(|_| "Invalid call audio session")?;
    Ok(format!("{label}:{id}"))
}

/// A new helper for a session replaces one still running; the replaced one is stopped by its own monitor thread.
fn register(runs: &mut HashMap<String, Run>, key: &str, run: Run) {
    if let Some(old) = runs.insert(key.into(), run) { old.active.store(false, Ordering::SeqCst); }
}

/// Stops the session's helper, or only the given run, so that a finished run cannot remove its replacement.
fn unregister(runs: &mut HashMap<String, Run>, key: &str, id: Option<u64>) {
    if runs.get(key).is_some_and(|run| match id { Some(id) => run.id == id, None => true }) {
        if let Some(run) = runs.remove(key) { run.active.store(false, Ordering::SeqCst); }
    }
}

/// Calls `emit` with each whole frame until the helper's output ends or `emit` declines; a partial last frame is dropped.
fn read_frames(mut reader: impl Read, mut emit: impl FnMut(&[u8]) -> bool) {
    let mut frame = [0u8; FRAME_BYTES];
    while reader.read_exact(&mut frame).is_ok() && emit(&frame) {}
}

/// The helper reports a failure as one JSON line on stderr: {"error": "..."}. Other lines are diagnostics.
fn helper_error(line: &str) -> Option<String> {
    serde_json::from_str::<Value>(line).ok()?.get("error")?.as_str().map(str::to_owned)
}

fn frame_event(session_id: &str, frame: &[u8]) -> Value {
    json!({"sessionId": session_id, "data": base64::engine::general_purpose::STANDARD.encode(frame)})
}

/// Next to the app's executable (`bundle.externalBin`; tauri-build copies it there in development too), otherwise
/// the build script's output.
fn helper_path(executable_dir: Option<&Path>) -> PathBuf {
    executable_dir.map(|dir| dir.join(HELPER)).filter(|path| path.is_file()).unwrap_or_else(|| {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries").join(format!("{HELPER}-{}", env!("TAURI_ENV_TARGET_TRIPLE")))
    })
}

/// Closing stdin asks the helper to stop and destroy its tap; one that has not exited after 1.5 s is killed. Reaped either way.
fn stop_helper(child: &mut Child, stdin: Option<ChildStdin>) {
    drop(stdin);
    let deadline = Instant::now() + Duration::from_millis(1500);
    while Instant::now() < deadline {
        if !matches!(child.try_wait(), Ok(None)) { return; }
        std::thread::sleep(Duration::from_millis(20));
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[tauri::command]
pub fn start_call_audio(window: tauri::WebviewWindow, session_id: String) -> Result<(), String> {
    let key = key(window.label(), &session_id)?;
    if !cfg!(target_os = "macos") { return Err("call audio is available on macOS only".into()); }
    let path = helper_path(std::env::current_exe().ok().as_deref().and_then(Path::parent));
    let mut command = crate::hidden_command(&path);
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(unix)] { use std::os::unix::process::CommandExt; command.process_group(0); }
    let mut child = command.spawn().map_err(|e| format!("the call audio helper could not start ({e})"))?;
    // Kept open for the helper's lifetime: it stops when its stdin closes, including when this app is gone.
    let stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or("Call audio output unavailable")?;
    let stderr = child.stderr.take().ok_or("Call audio errors unavailable")?;
    let active = Arc::new(AtomicBool::new(true));
    let id = NEXT_RUN.fetch_add(1, Ordering::SeqCst);
    let mut registry = runs().lock().map_err(|_| "Call audio registry unavailable")?;
    register(&mut registry, &key, Run { id, active: active.clone() });
    drop(registry);
    let (frames, frames_window, frames_id) = (active.clone(), window.clone(), session_id.clone());
    std::thread::spawn(move || read_frames(stdout, |frame| {
        frames.load(Ordering::SeqCst) && frames_window.emit(EVENT, frame_event(&frames_id, frame)).is_ok()
    }));
    let errors = std::thread::spawn(move || {
        BufReader::new(stderr).lines().map_while(Result::ok).fold(None, |first, line| first.or_else(|| helper_error(&line)))
    });
    std::thread::spawn(move || {
        let started = Instant::now();
        let mut stdin = stdin;
        let failure = loop {
            if !active.load(Ordering::SeqCst) || window.app_handle().get_webview_window("meeting-hud").is_none() { break None; }
            match child.try_wait() {
                Ok(Some(_)) => break Some(errors.join().ok().flatten().unwrap_or_else(|| "the call audio helper stopped unexpectedly".into())),
                Err(_) => break Some("the call audio helper could not be monitored".into()),
                Ok(None) => {}
            }
            if started.elapsed() >= LIMIT { break Some("the two-hour limit was reached".into()); }
            std::thread::sleep(Duration::from_millis(100));
        };
        if let Some(error) = failure.filter(|_| active.swap(false, Ordering::SeqCst)) {
            let _ = window.emit(EVENT, json!({"sessionId": session_id, "error": error}));
        }
        active.store(false, Ordering::SeqCst);
        stop_helper(&mut child, stdin.take());
        if let Ok(mut runs) = runs().lock() { unregister(&mut runs, &key, Some(id)); }
    });
    Ok(())
}

#[tauri::command]
pub fn stop_call_audio(window: tauri::WebviewWindow, session_id: String) -> Result<(), String> {
    let key = key(window.label(), &session_id)?;
    let mut registry = runs().lock().map_err(|_| "Call audio registry unavailable")?;
    unregister(&mut registry, &key, None);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SESSION: &str = "3f0c6a8e-6d55-4d43-9a4b-2b0f3c1e7d21";

    /// Hands out at most `step` bytes per read, as a pipe can.
    struct Trickle { data: Vec<u8>, at: usize, step: usize }
    impl Read for Trickle {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            let count = buf.len().min(self.step).min(self.data.len() - self.at);
            buf[..count].copy_from_slice(&self.data[self.at..self.at + count]);
            self.at += count;
            Ok(count)
        }
    }

    #[test]
    fn only_the_meeting_window_owns_call_audio_for_a_valid_session() {
        assert_eq!(key("meeting-hud", SESSION).unwrap(), format!("meeting-hud:{SESSION}"));
        assert!(key("main", SESSION).is_err());
        assert!(key("meeting-hud", "../session").is_err());
    }

    #[test]
    fn frames_are_whole_100_ms_blocks_however_the_pipe_splits_them() {
        let data: Vec<u8> = (0..FRAME_BYTES * 2 + 100).map(|index| index as u8).collect();
        let mut frames = Vec::new();
        read_frames(Trickle { data: data.clone(), at: 0, step: 999 }, |frame| { frames.push(frame.to_vec()); true });
        assert_eq!(frames.len(), 2);
        assert_eq!(frames.concat(), data[..FRAME_BYTES * 2]);
        let mut seen = 0;
        read_frames(Trickle { data, at: 0, step: FRAME_BYTES }, |_| { seen += 1; false });
        assert_eq!(seen, 1);
    }

    #[test]
    fn a_frame_event_carries_1600_little_endian_samples() {
        let samples: Vec<f32> = (0..1600).map(|index| index as f32 / 1600.0).collect();
        let bytes: Vec<u8> = samples.iter().flat_map(|sample| sample.to_le_bytes()).collect();
        let event = frame_event(SESSION, &bytes);
        assert_eq!(event["sessionId"], SESSION);
        let decoded = base64::engine::general_purpose::STANDARD.decode(event["data"].as_str().unwrap()).unwrap();
        let back: Vec<f32> = decoded.chunks_exact(4).map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap())).collect();
        assert_eq!(back, samples);
    }

    #[test]
    fn only_a_json_error_line_is_an_error() {
        assert_eq!(helper_error(r#"{"error":"could not create the system audio tap"}"#).as_deref(), Some("could not create the system audio tap"));
        assert_eq!(helper_error("memoria-call-audio: stopping: stdin closed"), None);
        assert_eq!(helper_error(r#"{"status":"capturing"}"#), None);
    }

    #[test]
    fn a_replaced_run_is_stopped_and_cannot_remove_its_replacement() {
        let mut runs = HashMap::new();
        let first = Arc::new(AtomicBool::new(true));
        let second = Arc::new(AtomicBool::new(true));
        register(&mut runs, "hud", Run { id: 1, active: first.clone() });
        register(&mut runs, "hud", Run { id: 2, active: second.clone() });
        assert!(!first.load(Ordering::SeqCst));
        unregister(&mut runs, "hud", Some(1));
        assert!(second.load(Ordering::SeqCst) && runs.contains_key("hud"));
        unregister(&mut runs, "hud", None);
        assert!(!second.load(Ordering::SeqCst) && runs.is_empty());
        unregister(&mut runs, "hud", None);
    }

    #[test]
    fn the_bundled_helper_beside_the_app_comes_first() {
        let dir = tempfile::tempdir().unwrap();
        let fallback = helper_path(Some(dir.path()));
        assert!(fallback.ends_with(format!("binaries/{HELPER}-{}", env!("TAURI_ENV_TARGET_TRIPLE"))));
        std::fs::write(dir.path().join(HELPER), b"").unwrap();
        assert_eq!(helper_path(Some(dir.path())), dir.path().join(HELPER));
    }
}
