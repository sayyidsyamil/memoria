use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock, mpsc::{sync_channel, SyncSender}};
use serde_json::{json, Value};
use tauri::{Emitter, Manager};

type Message = (Value, Option<SyncSender<Result<(), String>>>);
struct SessionInput { sender: SyncSender<Message>, ending: bool }
impl SessionInput {
    fn feed(&self, value: Value, receipt: SyncSender<Result<(), String>>) -> Result<(), String> {
        if self.ending { return Err("Live speech is already finalizing".into()); }
        self.sender.try_send((value, Some(receipt))).map_err(|_| "Live speech queue is full or closed".into())
    }
    fn end(&mut self, value: Value) -> Result<(), String> {
        if self.ending { return Ok(()); }
        self.sender.try_send((value, None)).map_err(|_| "Live caption queue full or closed; retry End without discarding accepted audio")?;
        self.ending = true;
        Ok(())
    }
}
static SESSIONS: OnceLock<Mutex<HashMap<String, SessionInput>>> = OnceLock::new();
fn sessions() -> &'static Mutex<HashMap<String, SessionInput>> { SESSIONS.get_or_init(|| Mutex::new(HashMap::new())) }
fn key(window: &tauri::WebviewWindow, id: &str) -> Result<String,String> {
    if window.label() != "meeting-hud" { return Err("Live speech is owned by the meeting HUD".into()); }
    uuid::Uuid::parse_str(id).map_err(|_| "Invalid speech session")?;
    Ok(format!("{}:{id}",window.label()))
}

#[tauri::command]
pub fn start_live_speech(window: tauri::WebviewWindow, vault_path: String, session_id: String) -> Result<(),String> {
    let key = key(&window,&session_id)?;
    let boundary = super::vault::VaultBoundary::from_request(Some(&vault_path))?;
    let resource = window.app_handle().path().resource_dir().map_err(|e|e.to_string())?.join("memory/live_speech.py");
    let script = if resource.exists() {resource} else {std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/memory/live_speech.py")};
    let python = std::env::var("MEMORIA_SPEECH_PYTHON").unwrap_or_else(|_|std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.speech-runtime/bin/python").to_string_lossy().into_owned());
    let mut registry = sessions().lock().map_err(|_|"Speech registry unavailable")?;
    if registry.contains_key(&key) {return Err("Speech session already running".into());}
    let mut command = crate::hidden_command(python);
    super::model_manager::configure_models(&mut command);
    command.arg("-u").arg(script).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(unix)] {use std::os::unix::process::CommandExt; command.process_group(0);}
    let mut child = command.spawn().map_err(|e|e.to_string())?;
    let mut stdin = child.stdin.take().ok_or("Speech input unavailable")?;
    writeln!(stdin,"{}",json!({"vaultPath":boundary.requested_root(),"sessionId":session_id})).map_err(|e|e.to_string())?;
    let stdout = child.stdout.take().ok_or("Speech output unavailable")?;
    let (sender, receiver) = sync_channel::<Message>(32);
    let (ack_sender, ack_receiver) = sync_channel::<Result<u64, String>>(32);
    registry.insert(key.clone(), SessionInput { sender, ending: false });
    let output_window = window.clone();
    let output_id = session_id.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(mut value) = serde_json::from_str::<Value>(&line) {
                if let Some(index) = value["ack"].as_u64() { let _=ack_sender.send(Ok(index)); continue; }
                if let Some(error) = value["error"].as_str() { let _ = ack_sender.send(Err(error.to_string())); }
                value["sessionId"] = Value::String(output_id.clone());
                let _ = output_window.emit("meeting-live-speech",value);
            }
        }
    });
    std::thread::spawn(move || {
        let started = std::time::Instant::now();
        loop {
            if window.app_handle().get_webview_window("meeting-hud").is_none() {break;}
            match child.try_wait() {Ok(Some(status)) => {
                if !status.success() {let _=window.emit("meeting-live-speech",json!({"sessionId":session_id,"error":"Live speech worker stopped. Original recording continues."}));}
                break;
            }, Err(_)=>break, _=>{}}
            if started.elapsed().as_secs()>7200 {
                let _ = window.emit("meeting-live-speech", json!({"sessionId":session_id,"error":"Live caption session reached its two-hour limit. Original recording is preserved."}));
                break;
            }
            match receiver.recv_timeout(std::time::Duration::from_millis(100)) {
                Ok((value, receipt)) => {
                    if writeln!(stdin,"{value}").is_err(){
                        if let Some(receipt)=receipt {let _=receipt.send(Err("Live speech input closed".into()));}
                        break;
                    }
                    if let Some(receipt)=receipt {
                        let result=match ack_receiver.recv_timeout(std::time::Duration::from_secs(30)) {
                            Ok(Ok(index)) if Some(index)==value["index"].as_u64()=>Ok(()),
                            Ok(Err(error))=>Err(error),
                            _=>Err("Live speech processing stalled. Original audio is preserved.".into()),
                        };
                        let failed=result.is_err(); let _=receipt.send(result);
                        if failed {break;}
                    }
                    if value["end"].as_bool()==Some(true) {
                        drop(stdin);
                        let deadline=std::time::Instant::now()+std::time::Duration::from_secs(60);
                        while std::time::Instant::now()<deadline {
                            if matches!(child.try_wait(),Ok(Some(_))){break;}
                            std::thread::sleep(std::time::Duration::from_millis(100));
                        }
                        break;
                    }
                }, Err(std::sync::mpsc::RecvTimeoutError::Disconnected)=>break, _=>{}
            }
        }
        let _=child.kill(); let _=child.wait();
        if let Ok(mut registry)=sessions().lock(){registry.remove(&key);}
    });
    Ok(())
}

#[tauri::command]
pub async fn feed_live_speech(window:tauri::WebviewWindow,session_id:String,index:u32,data:String)->Result<(),String>{
    let key=key(&window,&session_id)?;
    if data.len()>90000{return Err("PCM segment too large".into());}
    super::blocking::run_blocking(move || {
        let (receipt, consumed)=sync_channel(1);
        sessions().lock().map_err(|_|"Speech registry unavailable")?
            .get(&key).ok_or("Live speech session unavailable")?
            .feed(json!({"index":index,"data":data}), receipt)?;
        consumed.recv_timeout(std::time::Duration::from_secs(35)).map_err(|_|"Live speech did not acknowledge audio".to_string())?
    }).await?
}

#[tauri::command]
pub fn end_live_speech(window:tauri::WebviewWindow,session_id:String,expected_chunks:Option<u32>,expected_samples:Option<u64>)->Result<(),String>{
    let key=key(&window,&session_id)?;
    if let Some(input)=sessions().lock().map_err(|_|"Speech registry unavailable")?.get_mut(&key){
        input.end(json!({"end":true,"expectedChunks":expected_chunks,"expectedSamples":expected_samples}))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_end_enqueue_preserves_the_session_for_retry() {
        let (sender, receiver) = sync_channel(1);
        let mut input = SessionInput { sender, ending: false };
        let (receipt, _) = sync_channel(1);
        input.feed(json!({"index":0}), receipt).unwrap();
        assert!(input.end(json!({"end":true})).is_err());
        assert!(!input.ending);
        receiver.recv().unwrap();
        input.end(json!({"end":true})).unwrap();
        assert!(input.ending);
        input.end(json!({"end":true})).unwrap();
        assert_eq!(receiver.recv().unwrap().0["end"], true);
        assert!(receiver.try_recv().is_err());
        let (receipt, _) = sync_channel(1);
        assert!(input.feed(json!({"index":1}), receipt).is_err());
    }
}
