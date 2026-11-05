use super::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Normalized version of VaultEntry with deterministic ordering and no machine-specific data.
/// Used for golden fixture comparison to ensure reproducible test output across machines.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
struct NormalizedVaultEntry {
    /// Relative path from vault root, with forward slashes (e.g. "note.md", "folder/note.md")
    path: String,
    filename: String,
    title: String,
    #[serde(rename = "isA", skip_serializing_if = "Option::is_none")]
    is_a: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    aliases: Vec<String>,
    #[serde(rename = "belongsTo", skip_serializing_if = "Vec::is_empty", default)]
    belongs_to: Vec<String>,
    #[serde(rename = "relatedTo", skip_serializing_if = "Vec::is_empty", default)]
    related_to: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(skip_serializing_if = "is_false", default)]
    archived: bool,
    #[serde(rename = "fileSize")]
    file_size: u64,
    snippet: String,
    /// Generic relationship fields, sorted by key for deterministic output
    #[serde(skip_serializing_if = "HashMap::is_empty", default)]
    relationships: HashMap<String, Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    order: Option<i64>,
    #[serde(rename = "sidebarLabel", skip_serializing_if = "Option::is_none")]
    sidebar_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    template: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    view: Option<String>,
    #[serde(rename = "noteWidth", skip_serializing_if = "Option::is_none")]
    note_width: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    display: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    visible: Option<bool>,
    #[serde(skip_serializing_if = "is_false", default)]
    organized: bool,
    #[serde(skip_serializing_if = "is_false", default)]
    favorite: bool,
    #[serde(rename = "favoriteIndex", skip_serializing_if = "Option::is_none")]
    favorite_index: Option<i64>,
    #[serde(rename = "wordCount")]
    word_count: u32,
    #[serde(
        rename = "outgoingLinks",
        skip_serializing_if = "Vec::is_empty",
        default
    )]
    outgoing_links: Vec<String>,
    #[serde(skip_serializing_if = "HashMap::is_empty", default)]
    properties: HashMap<String, serde_json::Value>,
    #[serde(
        rename = "listPropertiesDisplay",
        skip_serializing_if = "Vec::is_empty",
        default
    )]
    list_properties_display: Vec<String>,
    #[serde(rename = "hasH1")]
    has_h1: bool,
    #[serde(rename = "fileKind")]
    file_kind: String,
}

fn is_false(value: &bool) -> bool {
    !value
}

/// Convert a VaultEntry to a NormalizedVaultEntry for golden fixture comparison.
/// Strips machine-specific data (absolute paths, timestamps) and ensures deterministic ordering.
fn normalize_vault_entry(entry: VaultEntry, vault_root: &Path) -> NormalizedVaultEntry {
    let relative_path = Path::new(&entry.path)
        .strip_prefix(vault_root)
        .unwrap_or(Path::new(&entry.path))
        .to_string_lossy()
        .replace('\\', "/");

    NormalizedVaultEntry {
        path: relative_path,
        filename: entry.filename,
        title: entry.title,
        is_a: entry.is_a,
        aliases: entry.aliases,
        belongs_to: entry.belongs_to,
        related_to: entry.related_to,
        status: entry.status,
        archived: entry.archived,
        file_size: entry.file_size,
        snippet: entry.snippet,
        relationships: entry.relationships,
        icon: entry.icon,
        color: entry.color,
        order: entry.order,
        sidebar_label: entry.sidebar_label,
        template: entry.template,
        sort: entry.sort,
        view: entry.view,
        note_width: entry.note_width,
        display: entry.display,
        visible: entry.visible,
        organized: entry.organized,
        favorite: entry.favorite,
        favorite_index: entry.favorite_index,
        word_count: entry.word_count,
        outgoing_links: entry.outgoing_links,
        properties: entry.properties,
        list_properties_display: entry.list_properties_display,
        has_h1: entry.has_h1,
        file_kind: entry.file_kind,
    }
}

/// Scan a vault and return normalized entries sorted by path for deterministic output.
fn scan_vault_normalized(vault_path: &Path) -> Result<Vec<NormalizedVaultEntry>, String> {
    let entries = scan_vault(vault_path, &HashMap::new())?;
    let mut normalized: Vec<NormalizedVaultEntry> = entries
        .into_iter()
        .map(|entry| normalize_vault_entry(entry, vault_path))
        .collect();

    normalized.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(normalized)
}

/// Write golden fixture JSON for a vault.
fn write_golden_fixture(
    vault_path: &Path,
    output_path: &Path,
) -> Result<Vec<NormalizedVaultEntry>, String> {
    let normalized = scan_vault_normalized(vault_path)?;
    let json = serde_json::to_string_pretty(&normalized)
        .map_err(|e| format!("Failed to serialize: {}", e))?;

    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {}", e))?;
    }

    fs::write(output_path, json).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(normalized)
}

/// Read golden fixture JSON and compare with current vault scan.
fn verify_against_golden(vault_path: &Path, golden_path: &Path) -> Result<(), String> {
    let golden_json =
        fs::read_to_string(golden_path).map_err(|e| format!("Failed to read golden: {}", e))?;
    let golden: Vec<NormalizedVaultEntry> =
        serde_json::from_str(&golden_json).map_err(|e| format!("Failed to parse golden: {}", e))?;

    let current = scan_vault_normalized(vault_path)?;

    if current != golden {
        let current_json = serde_json::to_string_pretty(&current).unwrap();
        let golden_json_pretty = serde_json::to_string_pretty(&golden).unwrap();
        return Err(format!(
            "Vault scan output differs from golden fixture.\n\
             Golden path: {}\n\
             Expected {} entries, got {} entries.\n\
             \n\
             To update the golden fixture, run:\n\
             REGENERATE_GOLDEN=1 cargo test --package memoria --lib vault::golden_vault_fixtures\n\
             \n\
             Current output:\n{}\n\
             \n\
             Expected (golden):\n{}",
            golden_path.display(),
            golden.len(),
            current.len(),
            current_json,
            golden_json_pretty
        ));
    }

    Ok(())
}

/// Get the fixtures directory for golden vault entries.
fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src")
        .join("vault")
        .join("mod_tests")
        .join("fixtures")
        .join("golden")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn demo_vault_v2() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("Failed to get repo root")
            .join("demo-vault-v2")
    }

    fn should_regenerate() -> bool {
        std::env::var("REGENERATE_GOLDEN").is_ok()
    }

    #[test]
    fn test_demo_vault_v2_golden_fixture() {
        let vault_path = demo_vault_v2();
        if !vault_path.exists() {
            panic!("demo-vault-v2 not found at {}", vault_path.display());
        }

        let golden_path = fixtures_dir().join("demo-vault-v2.json");

        if should_regenerate() {
            let entries = write_golden_fixture(&vault_path, &golden_path)
                .expect("Failed to write golden fixture");
            eprintln!(
                "✓ Regenerated golden fixture for demo-vault-v2: {} entries at {}",
                entries.len(),
                golden_path.display()
            );
        } else {
            verify_against_golden(&vault_path, &golden_path)
                .expect("Golden fixture verification failed");
        }
    }
}
