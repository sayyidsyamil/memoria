use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use base64::Engine;

#[tauri::command]
pub fn layout_meeting_hud(window: tauri::WebviewWindow, width: f64, height: f64, review: bool) -> Result<(), String> {
    if window.label() != "meeting-hud" { return Err("Only the meeting HUD can set its layout".into()); }
    if !(320.0..=900.0).contains(&width) || !(60.0..=800.0).contains(&height) {
        return Err("Invalid meeting window dimensions".into());
    }
    let monitor = window.current_monitor().map_err(|e| e.to_string())?.ok_or("Display unavailable")?;
    let scale = monitor.scale_factor();
    let origin = monitor.position();
    let size = monitor.size();
    let x = origin.x as f64 / scale + (size.width as f64 / scale - width) / 2.0;
    let y = origin.y as f64 / scale + if review { ((size.height as f64 / scale - height) / 2.0).max(38.0) } else { 38.0 };
    window.set_size(tauri::LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
    window.set_position(tauri::LogicalPosition::new(x, y)).map_err(|e| e.to_string())
}

fn persist_chunk(root: &std::path::Path, session_id: &str, index: u32, data: &str) -> Result<(), String> {
    let id = uuid::Uuid::parse_str(session_id).map_err(|_| "Invalid session ID")?;
    let directory = root.join(".memoria-recordings").join(id.to_string());
    let parent = root.join(".memoria-recordings");
    if parent.is_symlink() || directory.is_symlink() { return Err("Recording directory cannot be a symlink".into()); }
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
    if bytes.len() > 8 * 1024 * 1024 { return Err("Audio segment exceeds 8 MB".into()); }
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let destination = directory.join(format!("{index:010}.audio"));
    if destination.is_symlink() { return Err("Audio segment cannot be a symlink".into()); }
    if destination.exists() {
        return if std::fs::read(&destination).map_err(|e| e.to_string())? == bytes { Ok(()) }
        else { Err("Audio segment already exists with different bytes".into()) };
    }
    use std::io::Write;
    let temporary = directory.join(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|e| e.to_string())?;
    file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
    std::fs::rename(&temporary, &destination).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_meeting_chunk(vault_path: String, session_id: String, index: u32, data: String) -> Result<(), String> {
    let boundary = super::vault::VaultBoundary::from_request(Some(&vault_path))?;
    let root = boundary.requested_root().to_path_buf();
    super::blocking::run_blocking(move || persist_chunk(&root, &session_id, index, &data)).await?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recording_chunks_are_durable_and_retry_safe() {
        let root = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let data = base64::engine::general_purpose::STANDARD.encode(b"audio segment");
        persist_chunk(root.path(), &id, 0, &data).unwrap();
        persist_chunk(root.path(), &id, 0, &data).unwrap();
        assert_eq!(std::fs::read(root.path().join(".memoria-recordings").join(&id).join("0000000000.audio")).unwrap(), b"audio segment");
        assert!(persist_chunk(root.path(), &id, 0, "YWJj").is_err());
        assert!(persist_chunk(root.path(), "../outside", 0, &data).is_err());
    }
}

#[tauri::command]
pub fn open_meeting_hud(app: tauri::AppHandle, vault_path: String) -> Result<(), String> {
    let boundary = super::vault::VaultBoundary::from_request(Some(&vault_path))?;
    if let Some(hud) = app.get_webview_window("meeting-hud") {
        hud.show().map_err(|e| e.to_string())?;
        return hud.set_focus().map_err(|e| e.to_string());
    }
    let main = app.get_webview_window("main").ok_or("Workspace window unavailable")?;
    let monitor = main.current_monitor().map_err(|e| e.to_string())?.ok_or("Display unavailable")?;
    let scale = monitor.scale_factor();
    let position = monitor.position();
    let size = monitor.size();
    let mut route = tauri::Url::parse("tauri://localhost/").map_err(|e| e.to_string())?;
    route.query_pairs_mut().append_pair("meetingHud", "1")
        .append_pair("vault", &boundary.requested_root().to_string_lossy());
    let relative = format!("/?{}", route.query().unwrap_or(""));
    WebviewWindowBuilder::new(&app, "meeting-hud", WebviewUrl::App(relative.into()))
        .title("Memoria Meeting").inner_size(360.0, 68.0)
        .position(position.x as f64 / scale + (size.width as f64 / scale - 360.0) / 2.0,
                  position.y as f64 / scale + 38.0)
        // The HUD is used while another app (Zoom, Meet, Teams) is in front, so the first click must act on the
        // button instead of only activating the window.
        .accept_first_mouse(true)
        .decorations(false).transparent(true).resizable(false).always_on_top(true).skip_taskbar(true)
        .build().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn meeting_capture_ready(app: tauri::AppHandle) -> Result<(), String> {
    app.get_webview_window("main").ok_or("Workspace unavailable")?.hide().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn show_meeting_workspace(app: tauri::AppHandle) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("Workspace unavailable")?;
    main.show().map_err(|e| e.to_string())?;
    main.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn finish_meeting_hud(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "meeting-hud" { return Err("Only the meeting HUD can finish its session".into()); }
    window.destroy().map_err(|e| e.to_string())
}
