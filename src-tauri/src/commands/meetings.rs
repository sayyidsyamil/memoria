use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MeetingOperation { List, Get, Save, Delete }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MeetingRequest {
    vault_path: String,
    operation: MeetingOperation,
    id: Option<String>,
    record: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct MeetingApiError { code: String, message: String }

fn failure(code: &str, message: &str) -> MeetingApiError {
    MeetingApiError { code: code.into(), message: message.into() }
}

/// Typed desktop API. The Python application service owns record validation and persistence.
/// Reuses the established process transport, deadlines, and workspace boundary.
#[tauri::command]
pub async fn meetings_api(window: tauri::WebviewWindow, request: MeetingRequest) -> Result<Value, MeetingApiError> {
    super::vault::VaultBoundary::from_request(Some(&request.vault_path))
        .map_err(|_| failure("WORKSPACE_UNAVAILABLE", "The selected workspace is unavailable."))?;
    match request.operation {
        MeetingOperation::Get | MeetingOperation::Delete => {
            uuid::Uuid::parse_str(request.id.as_deref().unwrap_or(""))
                .map_err(|_| failure("INVALID_REQUEST", "A valid meeting identifier is required."))?;
        }
        MeetingOperation::Save => {
            if !request.record.as_ref().is_some_and(Value::is_object) {
                return Err(failure("INVALID_REQUEST", "A meeting record is required."));
            }
        }
        MeetingOperation::List => {}
    }
    let operation = match request.operation { MeetingOperation::List => "list", MeetingOperation::Get => "get", MeetingOperation::Save => "save", MeetingOperation::Delete => "delete" };
    let response = super::wiki_memory::wiki_memory(window, json!({
        "action": "meeting_api", "vaultPath": request.vault_path,
        "operation": operation, "id": request.id, "record": request.record,
    })).await.map_err(|_| failure("RUNTIME_UNAVAILABLE", "The meeting runtime is unavailable or timed out. Please try again."))?;
    if response["ok"] == true { return Ok(response["data"].clone()); }
    let error = &response["error"];
    Err(failure(error["code"].as_str().unwrap_or("INVALID_RESPONSE"), error["message"].as_str().unwrap_or("The meeting service returned an invalid response.")))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn request_contract_rejects_unknown_operations_and_fields() {
        assert!(serde_json::from_value::<MeetingRequest>(json!({"vaultPath":"/vault","operation":"purge"})).is_err());
        assert!(serde_json::from_value::<MeetingRequest>(json!({"vaultPath":"/vault","operation":"list","unexpected":true})).is_err());
        assert!(serde_json::from_value::<MeetingRequest>(json!({"vaultPath":"/vault","operation":"list"})).is_ok());
    }
}
