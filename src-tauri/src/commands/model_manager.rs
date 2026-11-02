use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock, atomic::{AtomicBool, Ordering}};
use serde_json::{json, Value};
use tauri::Manager;

struct Worker { child: Child, address: String, status: Value }
static WORKERS: OnceLock<Mutex<HashMap<String, Worker>>> = OnceLock::new();
static ADDRESSES: OnceLock<HashMap<String, String>> = OnceLock::new();
static STOPPED: AtomicBool = AtomicBool::new(false);
fn workers() -> &'static Mutex<HashMap<String, Worker>> { WORKERS.get_or_init(|| Mutex::new(HashMap::new())) }
fn python(kind: &str) -> String {
    let variable = match kind { "speech" => "MEMORIA_SPEECH_PYTHON", "embed" => "MEMORIA_EMBED_PYTHON", _ => "MEMORIA_MEMORY_PYTHON" };
    std::env::var(variable).unwrap_or_else(|_| match kind {
        "speech" => std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.speech-runtime/bin/python").to_string_lossy().into_owned(),
        "embed" => std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.embed-runtime/bin/python").to_string_lossy().into_owned(),
        _ => "/opt/homebrew/bin/python3.11".into(),
    })
}

pub fn start_models(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let id = uuid::Uuid::new_v4().simple().to_string();
        let addresses = ADDRESSES.get_or_init(|| ["speech", "qwen", "embed"].iter().map(|kind| (kind.to_string(),
            std::env::temp_dir().join(format!("mm-{}-{}-{}.sock", std::process::id(), &id[..8], kind)).to_string_lossy().into_owned())).collect());
        let mut attempts: HashMap<&str, u32> = HashMap::new();
        loop {
        for kind in ["speech", "qwen", "embed"] {
            if STOPPED.load(Ordering::SeqCst) { break; }
            {
                let mut registry=workers().lock().unwrap();
                if let Some(worker)=registry.get_mut(kind) {
                    if matches!(worker.child.try_wait(),Ok(None)) && worker.status["state"]=="ready" {continue;}
                    if worker.status["state"]=="preparing" {continue;}
                }
                if *attempts.get(kind).unwrap_or(&0)>=3 {continue;}
                if let Some(mut old)=registry.remove(kind) {let _=old.child.kill();let _=old.child.wait();let _=std::fs::remove_file(old.address);}
            }
            *attempts.entry(kind).or_insert(0)+=1;
            let address = addresses[kind].clone();
            let base = app.path().resource_dir().unwrap_or_default().join("memory");
            let base = if base.join("resident_server.py").exists() { base } else { std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/memory") };
            let mut command = crate::hidden_command(python(kind));
            let started=std::time::Instant::now();
            command.arg("-u");
            if kind == "qwen" { command.arg(base.join("model_server.py")).arg(&address).arg("--resident"); }
            else { command.arg(base.join("resident_server.py")).arg(kind).arg(&address); }
            command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).env("HF_HUB_OFFLINE", "1").env("TRANSFORMERS_OFFLINE", "1");
            match command.spawn() {
                Ok(mut child) => {
                    let stdout = child.stdout.take().unwrap();
                    {
                        let mut registry = workers().lock().unwrap();
                        if STOPPED.load(Ordering::SeqCst) { let _=child.kill(); let _=child.wait(); break; }
                        registry.insert(kind.into(), Worker { child, address, status: json!({"state":"preparing"}) });
                    }
                    let mut outcome = json!({"state":"failed","message":"Model worker stopped during preparation"});
                    let (sender, receiver) = std::sync::mpsc::channel();
                    std::thread::spawn(move || {
                        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                            if let Ok(value)=serde_json::from_str::<Value>(&line) {
                                if value.get("ready").is_some() || value.get("error").is_some() { let _=sender.send(value); break; }
                            }
                        }
                    });
                    match receiver.recv_timeout(std::time::Duration::from_secs(60)) {
                        Ok(value) => {
                            if value.get("ready").is_some() { outcome=json!({"state":"ready","mlxBytes":value["mlxBytes"],"pid":value["pid"],"loadSeconds":started.elapsed().as_secs_f64(),"attempt":attempts[kind]}); }
                            if value.get("error").is_some() { outcome=json!({"state":"failed","message":value["error"]}); }
                        }, Err(_) => { outcome=json!({"state":"failed","message":"Preparation timed out. Check macOS file-access permissions, then restart Memoria."}); }
                    }
                    if let Some(worker)=workers().lock().unwrap().get_mut(kind) {
                        if outcome["state"]=="failed" {let _=worker.child.kill();let _=worker.child.wait();}
                        worker.status=outcome;
                    }
                }, Err(error) => { eprintln!("Model {kind} unavailable: {error}"); }
            }
        }
        if STOPPED.load(Ordering::SeqCst) {break;}
        std::thread::sleep(std::time::Duration::from_secs(5));
        }
    });
}

pub fn configure_models(command: &mut Command) {
    if let Some(addresses)=ADDRESSES.get() {
        for (kind, address) in addresses.iter() {
            let variable=match kind.as_str(){"speech"=>"MEMORIA_SPEECH_SOCKET","embed"=>"MEMORIA_EMBED_SOCKET",_=>"MEMORIA_QWEN_SOCKET"};
            command.env(variable,address);
        }
    }
}

#[tauri::command]
pub fn ai_model_status() -> Value {
    let mut result=json!({});
    if let Ok(mut registry)=workers().lock() {
        for kind in ["speech","qwen","embed"] {
            if let Some(worker)=registry.get_mut(kind) {
                if matches!(worker.child.try_wait(),Ok(Some(_))) {worker.status=json!({"state":"failed","message":"Model worker stopped. Restart Memoria to prepare it again."});}
                result[kind]=worker.status.clone();
            } else {result[kind]=json!({"state":"queued"});}
        }
    }
    result
}

pub fn stop_models() {
    STOPPED.store(true,Ordering::SeqCst);
    if let Ok(mut registry)=workers().lock() {
        for (_,mut worker) in registry.drain() {
            let _=worker.child.kill(); let _=worker.child.wait();
            let _=std::fs::remove_file(&worker.address);
            let _=std::fs::remove_file(format!("{}.lock",worker.address));
        }
    }
}
