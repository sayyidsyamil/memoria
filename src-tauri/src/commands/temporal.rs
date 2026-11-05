use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TemporalRequest { vault_path: String, method: String, params: Option<Value> }

#[derive(Serialize)]
pub struct TemporalError { code: String, message: String }

#[tauri::command]
pub async fn temporal_api(window: tauri::WebviewWindow, request: TemporalRequest) -> Result<Value, TemporalError> {
    let error = |code: &str, message: &str| TemporalError { code: code.into(), message: message.into() };
    super::vault::VaultBoundary::from_request(Some(&request.vault_path)).map_err(|_| error("WORKSPACE_UNAVAILABLE", "The selected workspace is unavailable."))?;
    let response = super::wiki_memory::wiki_memory(window, json!({"action":"temporal_api","vaultPath":request.vault_path,"method":request.method,"params":request.params.unwrap_or_else(|| json!({}))})).await
        .map_err(|message| error("RUNTIME_UNAVAILABLE", &message))?;
    if response["ok"] == true { Ok(response["data"].clone()) }
    else { Err(error(response["error"]["code"].as_str().unwrap_or("TEMPORAL_REQUEST_FAILED"), response["error"]["message"].as_str().unwrap_or("Temporal request failed."))) }
}

#[tauri::command]
pub async fn live_memory_check(window: tauri::WebviewWindow, vault_path: String, statement: String, job_id: Option<String>) -> Result<Value, TemporalError> {
    if statement.is_empty() || statement.len() > 8000 {
        return Err(TemporalError { code: "INVALID_REQUEST".into(), message: "A short meeting statement is required.".into() });
    }
    let response = super::wiki_memory::wiki_memory(window, json!({"action":"live_check","vaultPath":vault_path,"statement":statement,"jobId":job_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string())})).await
        .map_err(|message| TemporalError { code: "RUNTIME_UNAVAILABLE".into(), message })?;
    if response["ok"] == true { Ok(response["data"].clone()) }
    else { Err(TemporalError { code: response["error"]["code"].as_str().unwrap_or("LIVE_CHECK_FAILED").into(), message: response["error"]["message"].as_str().unwrap_or("Live check failed.").into() }) }
}

#[tauri::command]
pub async fn live_ask(window: tauri::WebviewWindow, vault_path: String, question: String, session_text: String, job_id: Option<String>) -> Result<Value, String> {
    if question.is_empty() || question.len() > 8000 || session_text.len() > 120000 { return Err("Meeting question or context exceeds its limit.".into()); }
    super::wiki_memory::wiki_memory(window, json!({"action":"live_ask","vaultPath":vault_path,"question":question,"sessionText":session_text,"jobId":job_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string())})).await
}
