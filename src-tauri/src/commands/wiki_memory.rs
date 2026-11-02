use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, Stdio};
use std::sync::{Arc, Mutex, OnceLock, atomic::{AtomicBool, AtomicU64, Ordering}};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

type Jobs = Mutex<HashMap<String, Arc<AtomicBool>>>;
static JOBS: OnceLock<Jobs> = OnceLock::new();
fn jobs() -> &'static Jobs { JOBS.get_or_init(|| Mutex::new(HashMap::new())) }

fn key(app: &tauri::WebviewWindow, id: &str) -> Result<String, String> {
    if id.is_empty() || id.len() > 100 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Invalid memory job identifier".into());
    }
    Ok(format!("{}:{id}", app.label()))
}

#[tauri::command]
pub fn cancel_wiki_memory(window: tauri::WebviewWindow, job_id: String) -> Result<(), String> {
    let key = key(&window, &job_id)?;
    if let Some(cancelled) = jobs().lock().map_err(|_| "Memory job registry unavailable")?.get(&key) {
        cancelled.store(true, Ordering::SeqCst);
    }
    Ok(())
}

fn stop(child: &mut Child) {
    // Kill the owned process group too: embedding workers must not outlive a
    // cancelled model request. Write jobs are never user-cancellable.
    #[cfg(unix)]
    { let _ = crate::hidden_command("/bin/kill").args(["-TERM", "--", &format!("-{}", child.id())]).status(); }
    let _ = child.kill();
    let _ = child.wait();
}

/// Overall limit and, where it applies, the longest wait between reported stages. Long
/// recordings and long meetings are processed in parts that each report progress (five-minute
/// audio parts, transcript passages, extraction windows), so their deadline follows progress
/// rather than the meeting's length.
fn limits(action: &str, method: &str, speech: bool, cancellable: bool) -> (Duration, Option<Duration>) {
    match (action, method) {
        ("transcribe", _) => (Duration::from_secs(3 * 60 * 60), Some(Duration::from_secs(300))),
        ("compile", _) | ("temporal_api", "ingest_reviewed_meeting") => (Duration::from_secs(60 * 60), Some(Duration::from_secs(120))),
        _ if speech => (Duration::from_secs(300), None),
        _ if cancellable => (Duration::from_secs(120), None),
        _ => (Duration::from_secs(60), None),
    }
}

fn timed_out((overall, idle): (Duration, Option<Duration>), elapsed: Duration, quiet: Duration) -> bool {
    elapsed > overall || idle.is_some_and(|idle| quiet > idle)
}

#[tauri::command]
pub async fn wiki_memory(window: tauri::WebviewWindow, mut request: Value) -> Result<Value, String> {
    let vault = request["vaultPath"].as_str().ok_or("Missing workspace path")?;
    let boundary = super::vault::VaultBoundary::from_request(Some(vault))?;
    request["vaultPath"] = Value::String(boundary.requested_root().to_string_lossy().to_string());
    let action = request["action"].as_str().unwrap_or("").to_string();
    let speech = matches!(action.as_str(), "transcribe" | "speaker_profiles" | "save_voice_profiles" | "meeting_draft");
    if action == "transcribe" {
        let audio = request["audioPath"].as_str().ok_or("Missing audio path")?.to_string();
        let checked = boundary.validate_existing_paths(&[audio])?;
        request["audioPath"] = Value::String(checked[0].clone());
        uuid::Uuid::parse_str(request["sessionId"].as_str().ok_or("Missing session identifier")?).map_err(|_| "Invalid session identifier")?;
    }
    if action == "save_voice_profiles" {
        uuid::Uuid::parse_str(request["sessionId"].as_str().ok_or("Missing session identifier")?).map_err(|_| "Invalid session identifier")?;
    }
    let cancellable = matches!(action.as_str(), "compile" | "ask" | "brief" | "transcribe" | "live_ask" | "live_check") || (action == "temporal_api" && request["method"] == "ingest_reviewed_meeting");
    let method = request["method"].as_str().unwrap_or("").to_string();
    let job_id = request["jobId"].as_str().map(str::to_string).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let job_key = key(&window, &job_id)?;
    let cancelled = Arc::new(AtomicBool::new(false));
    if cancellable {
        let mut registry = jobs().lock().map_err(|_| "Memory job registry unavailable")?;
        if registry.contains_key(&job_key) { return Err("Memory job already running".into()); }
        registry.insert(job_key.clone(), cancelled.clone());
    }
    let filename = if speech { "transcribe.py" } else { "engine.py" };
    let resource = window.app_handle().path().resource_dir().map_err(|error| error.to_string())?.join("memory").join(filename);
    let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/memory").join(filename);
    let script = if resource.exists() { resource } else { source };
    let result = super::blocking::run_blocking(move || {
        let run = || -> Result<Value, String> {
            let python = super::model_runtime::python(if speech { "speech" } else { "memory" });
            let mut command = crate::hidden_command(python);
            super::model_manager::configure_models(&mut command);
            command.arg("-u").arg(script).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
            #[cfg(unix)]
            { use std::os::unix::process::CommandExt; command.process_group(0); }
            let mut child = command.spawn().map_err(|_| "Local memory runtime unavailable. Check model setup.")?;
            if let Err(error) = child.stdin.take().ok_or("Missing memory input")?.write_all(request.to_string().as_bytes()) {
                stop(&mut child); return Err(error.to_string());
            }
            let stdout = child.stdout.take().ok_or("Missing memory output")?;
            let stderr = child.stderr.take().ok_or("Missing memory diagnostics")?;
            let started = Instant::now();
            let heard = Arc::new(AtomicU64::new(0));
            let last_stage = heard.clone();
            let output = std::thread::spawn(move || {
                let mut reply = None;
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    if let Ok(value) = serde_json::from_str::<Value>(&line) {
                        if let Some(stage) = value["progress"].as_str() {
                            last_stage.store(started.elapsed().as_millis() as u64, Ordering::SeqCst);
                            let _ = window.emit("wiki-memory-progress", serde_json::json!({"jobId":job_id,"stage":stage}));
                        } else { reply = Some(value); }
                    }
                }
                reply
            });
            let diagnostics = std::thread::spawn(move || { let _ = std::io::copy(&mut stderr.take(65536), &mut std::io::sink()); });
            let limit = limits(&action, &method, speech, cancellable);
            let failure = loop {
                if cancellable && cancelled.load(Ordering::SeqCst) { stop(&mut child); break Some("Memory request cancelled. No proposed changes were applied."); }
                let quiet = started.elapsed().saturating_sub(Duration::from_millis(heard.load(Ordering::SeqCst)));
                if timed_out(limit, started.elapsed(), quiet) { stop(&mut child); break Some("Memory request timed out. Check file permissions and local model setup, then retry."); }
                match child.try_wait() {
                    Ok(Some(_)) => break None,
                    Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                    Err(_) => { stop(&mut child); break Some("Memory runtime stopped unexpectedly."); }
                }
            };
            let reply = output.join().map_err(|_| "Memory output unavailable")?;
            let _ = diagnostics.join();
            if let Some(error) = failure { return Err(error.into()); }
            let reply = reply.ok_or("Memory runtime failed. Check local model setup and file permissions.")?;
            if let Some(error) = reply["error"].as_str() { return Err(error.to_string()); }
            Ok(reply["result"].clone())
        };
        let result = run();
        if cancellable { if let Ok(mut registry) = jobs().lock() { registry.remove(&job_key); } }
        result
    }).await?;
    result
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::process::CommandExt;
    #[test]
    fn cancellation_stops_owned_worker_group_promptly() {
        let mut child = std::process::Command::new("/bin/sh")
            .args(["-c", "sleep 30 & wait"]).process_group(0).spawn().unwrap();
        let started = Instant::now();
        stop(&mut child);
        assert!(started.elapsed() < Duration::from_secs(3));
        assert!(child.try_wait().unwrap().is_some());
    }
    #[test]
    fn long_meeting_deadlines_follow_reported_parts() {
        let minutes = |count: u64| Duration::from_secs(count * 60);
        let transcribe = limits("transcribe", "", true, true);
        assert!(!timed_out(transcribe, minutes(40), minutes(1)));
        assert!(timed_out(transcribe, minutes(40), minutes(6)));
        assert!(timed_out(transcribe, minutes(181), Duration::ZERO));
        for (action, method) in [("compile", ""), ("temporal_api", "ingest_reviewed_meeting")] {
            let parts = limits(action, method, false, true);
            assert!(!timed_out(parts, minutes(20), minutes(1)));
            assert!(timed_out(parts, minutes(20), minutes(3)));
        }
        assert!(timed_out(limits("speaker_profiles", "", true, false), minutes(6), Duration::ZERO));
        assert!(timed_out(limits("ask", "", false, true), minutes(3), Duration::ZERO));
        assert!(timed_out(limits("temporal_api", "overview", false, false), minutes(2), Duration::ZERO));
    }
}
