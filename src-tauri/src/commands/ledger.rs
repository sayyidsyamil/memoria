//! Bridge to the decision/commitment ledger engine.
//!
//! One persistent Python child (`memoria_engine.service`) is kept alive so that, when a language
//! model is used, it stays loaded between calls. Calls are serialised. The ledger state lives in
//! `<app data>/ledger/<hash of vault path>/`, outside the vault's git-tracked notes.

use std::collections::VecDeque;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use serde_json::Value;
use tauri::Manager;

use super::ledger_protocol::{ledger_home, read_ready, read_response, timeout_for, write_request, LedgerError};

const DEFAULT_PYTHON: &str = "/opt/homebrew/bin/python3.11";
const COMPILED_ENGINE_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../engine");
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);
const STDERR_LINES_KEPT: usize = 30;
const STDERR_LINES_SHOWN: usize = 4;
const EXTRACTORS: &[&str] = &["mlx", "keyword", "none"];

#[derive(Clone, Debug)]
struct EngineConfig {
    python: PathBuf,
    engine_dir: PathBuf,
    extractor: String,
}

impl EngineConfig {
    fn from_env() -> Result<Self, LedgerError> {
        let var = |name: &str| std::env::var(name).ok().filter(|v| !v.trim().is_empty());
        let extractor = var("MEMORIA_LEDGER_EXTRACTOR").unwrap_or_else(|| "mlx".into());
        if !EXTRACTORS.contains(&extractor.as_str()) {
            return Err(LedgerError::Invalid(format!(
                "MEMORIA_LEDGER_EXTRACTOR is \"{extractor}\"; use mlx, keyword or none."
            )));
        }
        Ok(Self {
            python: var("MEMORIA_PYTHON").map_or_else(|| PathBuf::from(DEFAULT_PYTHON), PathBuf::from),
            engine_dir: var("MEMORIA_ENGINE_DIR").map_or_else(|| PathBuf::from(COMPILED_ENGINE_DIR), PathBuf::from),
            extractor,
        })
    }

    fn check_installed(&self) -> Result<(), LedgerError> {
        if !self.python.exists() {
            return Err(LedgerError::PythonMissing(self.python.clone()));
        }
        if !self.engine_dir.join("memoria_engine").is_dir() {
            return Err(LedgerError::EngineMissing(self.engine_dir.clone()));
        }
        Ok(())
    }
}

type SharedChild = Arc<Mutex<Child>>;

struct Session {
    child: SharedChild,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    stderr_tail: Arc<Mutex<VecDeque<String>>>,
    stderr_thread: Option<JoinHandle<()>>,
    home: PathBuf,
    extractor: String,
    next_id: u64,
}

impl Session {
    fn is_alive(&self) -> bool {
        matches!(self.child.lock().map(|mut c| c.try_wait()), Ok(Ok(None)))
    }

    /// Stop the child and return the last lines it wrote to stderr (useful in error messages).
    fn shutdown(mut self) -> String {
        kill_child(&self.child);
        if let Some(thread) = self.stderr_thread.take() {
            let _ = thread.join();
        }
        self.stderr_tail
            .lock()
            .map(|t| t.iter().rev().take(STDERR_LINES_SHOWN).rev().cloned().collect::<Vec<_>>().join(" | "))
            .unwrap_or_default()
    }
}

fn kill_child(child: &SharedChild) {
    if let Ok(mut c) = child.lock() {
        let _ = c.kill();
        let _ = c.wait();
    }
}

static SESSION: Mutex<Option<Session>> = Mutex::new(None);
/// Reachable without taking `SESSION`, so a running call can be interrupted on exit.
static ACTIVE_CHILD: Mutex<Option<SharedChild>> = Mutex::new(None);

fn remember_active(child: Option<SharedChild>) {
    if let Ok(mut slot) = ACTIVE_CHILD.lock() {
        *slot = child;
    }
}

fn spawn_session(config: &EngineConfig, home: &Path) -> Result<Session, LedgerError> {
    config.check_installed()?;
    std::fs::create_dir_all(home).map_err(|e| LedgerError::Spawn(format!("cannot create {}: {e}", home.display())))?;
    let mut child = Command::new(&config.python)
        .args(["-m", "memoria_engine.service", "--home"])
        .arg(home)
        .args(["--extractor", &config.extractor])
        .current_dir(&config.engine_dir)
        .env("PYTHONPATH", &config.engine_dir)
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| LedgerError::Spawn(format!("{e} ({})", config.python.display())))?;
    let stdin = child.stdin.take().ok_or_else(|| LedgerError::Spawn("no stdin".into()))?;
    let stdout = child.stdout.take().ok_or_else(|| LedgerError::Spawn("no stdout".into()))?;
    let stderr = child.stderr.take().ok_or_else(|| LedgerError::Spawn("no stderr".into()))?;

    let tail = Arc::new(Mutex::new(VecDeque::new()));
    let tail_writer = Arc::clone(&tail);
    let stderr_thread = std::thread::spawn(move || {
        use std::io::BufRead;
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Ok(mut lines) = tail_writer.lock() {
                if lines.len() == STDERR_LINES_KEPT {
                    lines.pop_front();
                }
                lines.push_back(line);
            }
        }
    });

    let child = Arc::new(Mutex::new(child));
    remember_active(Some(Arc::clone(&child)));
    let mut session = Session {
        child,
        stdin,
        stdout: BufReader::new(stdout),
        stderr_tail: tail,
        stderr_thread: Some(stderr_thread),
        home: home.to_path_buf(),
        extractor: config.extractor.clone(),
        next_id: 1,
    };
    let (ready, timed_out) = with_watchdog(&session.child, STARTUP_TIMEOUT, || read_ready(&mut session.stdout));
    if timed_out {
        session.shutdown();
        return Err(LedgerError::Timeout(STARTUP_TIMEOUT));
    }
    match ready {
        Ok(_) => Ok(session),
        Err(LedgerError::Died(_)) => Err(LedgerError::Died(session.shutdown())),
        Err(other) => {
            session.shutdown();
            Err(other)
        }
    }
}

/// Run `work`, killing `child` if it takes longer than `limit`. Returns the result and whether the kill happened.
fn with_watchdog<T>(child: &SharedChild, limit: Duration, work: impl FnOnce() -> T) -> (T, bool) {
    let (done_tx, done_rx) = mpsc::channel::<()>();
    let fired = Arc::new(AtomicBool::new(false));
    let (watched, flag) = (Arc::clone(child), Arc::clone(&fired));
    let watchdog = std::thread::spawn(move || {
        if done_rx.recv_timeout(limit) == Err(mpsc::RecvTimeoutError::Timeout) {
            flag.store(true, Ordering::SeqCst);
            if let Ok(mut c) = watched.lock() {
                let _ = c.kill();
            }
        }
    });
    let out = work();
    drop(done_tx);
    let _ = watchdog.join();
    (out, fired.load(Ordering::SeqCst))
}

fn exchange(session: &mut Session, method: &str, params: &Value) -> Result<Value, LedgerError> {
    let id = session.next_id;
    session.next_id += 1;
    let limit = timeout_for(method);
    let Session { child, stdin, stdout, .. } = session;
    let (result, timed_out) = with_watchdog(child, limit, || {
        write_request(stdin, id, method, params).map_err(|e| LedgerError::Died(e.to_string()))?;
        read_response(stdout, id)
    });
    if timed_out {
        return Err(LedgerError::Timeout(limit));
    }
    result
}

fn needs_restart(session: &Session, config: &EngineConfig, home: &Path) -> bool {
    session.home != home || session.extractor != config.extractor || !session.is_alive()
}

fn call_with(config: &EngineConfig, home: &Path, method: &str, params: &Value) -> Result<Value, LedgerError> {
    let mut slot = SESSION.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if slot.as_ref().is_some_and(|s| needs_restart(s, config, home)) {
        if let Some(old) = slot.take() {
            old.shutdown();
        }
    }
    if slot.is_none() {
        *slot = Some(spawn_session(config, home)?);
    }
    let session = slot.as_mut().expect("session was just created");
    match exchange(session, method, params) {
        Err(err @ (LedgerError::Engine { .. } | LedgerError::Invalid(_))) => Err(err),
        Err(LedgerError::Died(_)) => {
            let tail = slot.take().map(Session::shutdown).unwrap_or_default();
            Err(LedgerError::Died(tail))
        }
        Err(other) => {
            if let Some(old) = slot.take() {
                old.shutdown();
            }
            Err(other)
        }
        Ok(value) => Ok(value),
    }
}

/// Stop the service (kills it even while a call is running). Safe to call when nothing is running.
pub fn stop_ledger_service() {
    let active = ACTIVE_CHILD.lock().ok().and_then(|mut slot| slot.take());
    if let Some(child) = active {
        kill_child(&child);
    }
}

#[tauri::command]
pub async fn ledger_call(
    app: tauri::AppHandle,
    vault_path: String,
    method: String,
    params: Value,
) -> Result<Value, String> {
    if vault_path.trim().is_empty() {
        return Err("Open a vault first: the decision ledger is kept per vault.".into());
    }
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Memoria could not find its data folder: {e}"))?;
    let home = ledger_home(&data_dir, &vault_path);
    tauri::async_runtime::spawn_blocking(move || {
        let config = EngineConfig::from_env()?;
        call_with(&config, &home, &method, &params)
    })
    .await
    .map_err(|e| format!("The decision engine call was interrupted: {e}"))?
    .map_err(|e: LedgerError| e.to_string())
}

#[tauri::command]
pub fn ledger_stop() {
    stop_ledger_service();
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn real_service_answers_ping_and_registry_get_without_a_model() {
        let config = EngineConfig {
            python: PathBuf::from(std::env::var("MEMORIA_PYTHON").unwrap_or_else(|_| DEFAULT_PYTHON.into())),
            engine_dir: PathBuf::from(std::env::var("MEMORIA_ENGINE_DIR").unwrap_or_else(|_| COMPILED_ENGINE_DIR.into())),
            extractor: "none".into(),
        };
        if let Err(missing) = config.check_installed() {
            eprintln!("SKIPPED real-service test: {missing}");
            return;
        }
        let home = tempfile::tempdir().unwrap();

        let pong = call_with(&config, home.path(), "ping", &json!({})).unwrap();
        assert_eq!(pong["extractor"], "none");
        assert_eq!(pong["objects"], 0);

        let registry = call_with(&config, home.path(), "registry.get", &json!({})).unwrap();
        assert_eq!(registry, json!({"objects": [], "people": {}}));

        let unknown = call_with(&config, home.path(), "nope", &json!({})).unwrap_err();
        assert!(unknown.to_string().contains("unknown method"));
        assert!(call_with(&config, home.path(), "ping", &json!({})).is_ok(), "service survives an error response");

        stop_ledger_service();
        let again = call_with(&config, home.path(), "ping", &json!({})).unwrap();
        assert_eq!(again["extractor"], "none", "a killed service is restarted on the next call");
        stop_ledger_service();
    }

    #[test]
    fn missing_python_and_missing_engine_give_friendly_errors() {
        let bad_python = EngineConfig { python: "/nope/python".into(), engine_dir: ".".into(), extractor: "none".into() };
        assert!(bad_python.check_installed().unwrap_err().to_string().contains("/nope/python"));

        let dir = tempfile::tempdir().unwrap();
        let bad_engine = EngineConfig { python: std::env::current_exe().unwrap(), engine_dir: dir.path().into(), extractor: "none".into() };
        let err = bad_engine.check_installed().unwrap_err();
        assert!(err.to_string().contains(&dir.path().display().to_string()));
    }
}
