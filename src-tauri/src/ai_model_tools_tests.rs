use super::*;
use crate::ai_models::{
    AiModelApiKeyStorage, AiModelCapabilities, AiModelDefinition, AiModelProvider,
};
use serde_json::json;
use std::fs;

const CREATED_NOTE_PATH: &str = "nota-longa-teste-gerada-2.md";
const CREATED_NOTE_CONTENT: &str = "---\ntype: Note\n---\n\n# Nota longa de teste - gerada 2\n";

fn request(vault_path: String) -> AiModelStreamRequest {
    request_with_provider(provider(), Some(vault_path), Vec::new())
}

fn request_with_provider(
    provider: AiModelProvider,
    vault_path: Option<String>,
    vault_paths: Vec<String>,
) -> AiModelStreamRequest {
    AiModelStreamRequest {
        provider,
        model_id: "gpt-5-nano".into(),
        message: "Create the note".into(),
        system_prompt: Some("Use create_note for new notes.".into()),
        vault_path,
        vault_paths,
        api_key_override: None,
        event_name: None,
    }
}

fn provider() -> AiModelProvider {
    AiModelProvider {
        id: "openai".into(),
        name: "OpenAI".into(),
        kind: AiModelProviderKind::OpenAi,
        base_url: Some("https://api.openai.com/v1".into()),
        api_key_storage: Some(AiModelApiKeyStorage::LocalFile),
        api_key_env_var: None,
        headers: None,
        models: vec![AiModelDefinition {
            id: "gpt-5-nano".into(),
            display_name: None,
            context_window: None,
            max_output_tokens: None,
            capabilities: AiModelCapabilities {
                streaming: false,
                tools: false,
                vision: false,
                json_mode: false,
                reasoning: false,
            },
        }],
    }
}

fn create_note_response() -> serde_json::Value {
    tool_call_response(json!({
        "id": "call_create",
        "function": {
            "name": CREATE_NOTE_TOOL_NAME,
            "arguments": serde_json::to_string(&json!({
                "path": CREATED_NOTE_PATH,
                "content": CREATED_NOTE_CONTENT
            })).unwrap()
        }
    }))
}

fn tool_call_response(tool_call: serde_json::Value) -> serde_json::Value {
    json!({
        "choices": [{
            "message": {
                "tool_calls": [tool_call]
            }
        }]
    })
}

fn create_note_response_with_args(arguments: serde_json::Value) -> serde_json::Value {
    tool_call_response(json!({
        "function": {
            "name": CREATE_NOTE_TOOL_NAME,
            "arguments": arguments,
        }
    }))
}

fn create_note_error(arguments: serde_json::Value) -> String {
    let dir = tempfile::tempdir().unwrap();
    let request = request(dir.path().to_string_lossy().into_owned());

    execute_openai_tool_calls(&request, &create_note_response_with_args(arguments), |_| {})
        .unwrap_err()
}

fn assert_note_created(vault_path: &Path) {
    let actual = fs::read_to_string(vault_path.join(CREATED_NOTE_PATH)).unwrap();
    assert_eq!(actual, CREATED_NOTE_CONTENT);
}

fn assert_summary(summary: Option<String>) {
    assert_eq!(
        summary.as_deref(),
        Some("Created note: nota-longa-teste-gerada-2.md"),
    );
}

fn assert_tool_events(events: &[AiAgentStreamEvent]) {
    assert!(matches!(
        &events[0],
        AiAgentStreamEvent::ToolStart { tool_name, tool_id, input: Some(input) }
            if tool_name == CREATE_NOTE_TOOL_NAME && tool_id == "call_create" && input.contains(CREATED_NOTE_PATH)
    ));
    assert!(matches!(
        &events[1],
        AiAgentStreamEvent::ToolDone { tool_id, output: Some(output) }
            if tool_id == "call_create" && output.contains(CREATED_NOTE_PATH)
    ));
}

#[test]
fn openai_payload_offers_create_note_when_active_vault_is_loaded() {
    let dir = tempfile::tempdir().unwrap();
    let payload = openai_chat_payload(&request(dir.path().to_string_lossy().into_owned()));

    assert!(payload["tools"][0]["function"]["name"] == CREATE_NOTE_TOOL_NAME);
}

#[test]
fn openai_payload_offers_create_note_for_tool_capable_custom_models() {
    let dir = tempfile::tempdir().unwrap();
    let mut provider = provider();
    provider.kind = AiModelProviderKind::OpenAiCompatible;
    provider.models[0].capabilities.tools = true;
    let request = request_with_provider(
        provider,
        Some(dir.path().to_string_lossy().into_owned()),
        vec![],
    );

    let payload = openai_chat_payload(&request);

    assert!(payload["tools"][0]["function"]["name"] == CREATE_NOTE_TOOL_NAME);
}

#[test]
fn openai_payload_skips_create_note_when_no_active_vault_is_loaded() {
    let payload = openai_chat_payload(&request_with_provider(provider(), None, Vec::new()));

    assert!(payload.get("tools").is_none());
    assert!(payload.get("tool_choice").is_none());
}

#[test]
fn execute_openai_tool_calls_returns_none_without_tool_calls() {
    let dir = tempfile::tempdir().unwrap();
    let request = request(dir.path().to_string_lossy().into_owned());

    let summary = execute_openai_tool_calls(
        &request,
        &json!({ "choices": [{ "message": { "content": "No tools" } }] }),
        |_| {},
    )
    .unwrap();

    assert_eq!(summary, None);
}

#[test]
fn executes_openai_create_note_tool_call_inside_active_vault() {
    let dir = tempfile::tempdir().unwrap();
    let request = request(dir.path().to_string_lossy().into_owned());
    let mut events = Vec::new();

    let summary = execute_openai_tool_calls(&request, &create_note_response(), |event| {
        events.push(event)
    })
    .unwrap();

    assert_note_created(dir.path());
    assert_summary(summary);
    assert_tool_events(&events);
}

#[test]
fn executes_openai_create_note_with_object_arguments_and_selected_vault() {
    let primary = tempfile::tempdir().unwrap();
    let secondary = tempfile::tempdir().unwrap();
    let secondary_path = secondary.path().to_string_lossy().into_owned();
    let request = request_with_provider(
        provider(),
        Some(primary.path().to_string_lossy().into_owned()),
        vec![secondary_path.clone()],
    );
    let response = tool_call_response(json!({
        "function": {
            "name": CREATE_NOTE_TOOL_NAME,
            "arguments": {
                "path": "Generated/fallback-note.md",
                "is_a": "Project",
                "vaultPath": secondary_path,
            }
        }
    }));

    let summary = execute_openai_tool_calls(&request, &response, |_| {}).unwrap();

    assert_eq!(
        fs::read_to_string(secondary.path().join("Generated/fallback-note.md")).unwrap(),
        "---\ntype: \"Project\"\n---\n\n# fallback-note\n",
    );
    assert_eq!(
        summary.as_deref(),
        Some("Created note: Generated/fallback-note.md")
    );
    assert!(!primary.path().join("Generated/fallback-note.md").exists());
}

#[test]
fn execute_openai_tool_calls_rejects_unsupported_tool_before_running_it() {
    let dir = tempfile::tempdir().unwrap();
    let request = request(dir.path().to_string_lossy().into_owned());
    let response = tool_call_response(json!({
        "id": "call_delete",
        "function": {
            "name": "delete_note",
            "arguments": "{}",
        }
    }));
    let mut events = Vec::new();

    let error =
        execute_openai_tool_calls(&request, &response, |event| events.push(event)).unwrap_err();

    assert_eq!(error, "AI provider requested unsupported tool: delete_note");
    assert!(events.is_empty());
}

#[test]
fn execute_openai_tool_calls_rejects_malformed_arguments() {
    let error = create_note_error(json!("{not-json"));

    assert!(error.contains("Failed to parse AI tool arguments"));
}

#[test]
fn execute_openai_tool_calls_treats_non_object_arguments_as_empty() {
    let error = create_note_error(json!([]));

    assert_eq!(error, "create_note requires path.");
}

#[test]
fn execute_openai_tool_calls_rejects_existing_note_without_overwriting() {
    let dir = tempfile::tempdir().unwrap();
    let request = request(dir.path().to_string_lossy().into_owned());
    fs::write(dir.path().join("existing.md"), "# Existing\n").unwrap();
    let response = tool_call_response(json!({
        "function": {
            "name": CREATE_NOTE_TOOL_NAME,
            "arguments": serde_json::to_string(&json!({
                "path": "existing.md",
                "content": "# Replacement\n",
            })).unwrap(),
        }
    }));

    let error = execute_openai_tool_calls(&request, &response, |_| {}).unwrap_err();

    assert!(error.contains("already exists"));
    assert_eq!(
        fs::read_to_string(dir.path().join("existing.md")).unwrap(),
        "# Existing\n",
    );
}

#[test]
fn execute_openai_tool_calls_requires_path() {
    let error = create_note_error(json!("{}"));

    assert_eq!(error, "create_note requires path.");
}

#[test]
fn execute_openai_tool_calls_rejects_inactive_explicit_vault() {
    let active = tempfile::tempdir().unwrap();
    let inactive = tempfile::tempdir().unwrap();
    let request = request(active.path().to_string_lossy().into_owned());
    let response = tool_call_response(json!({
        "function": {
            "name": CREATE_NOTE_TOOL_NAME,
            "arguments": serde_json::to_string(&json!({
                "path": "inactive.md",
                "content": "# Inactive\n",
                "vaultPath": inactive.path().to_string_lossy(),
            })).unwrap(),
        }
    }));

    let error = execute_openai_tool_calls(&request, &response, |_| {}).unwrap_err();

    assert!(error.starts_with("Vault is not active in Memoria:"));
    assert!(!inactive.path().join("inactive.md").exists());
}
