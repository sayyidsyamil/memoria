use chrono::{DateTime, FixedOffset, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, Metadata};
use std::io::{ErrorKind, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;
use tempfile::{Builder, NamedTempFile};
use uuid::Uuid;

const STORAGE_NAME: &str = ".memoria-recordings";
const MANIFEST_NAME: &str = "recording.json";
const PLAYBACK_NAME: &str = "playback.webm";
const PLAYBACK_EXTENSIONS: [&str; 5] = ["wav", "webm", "m4a", "mp3", "flac"];
const REMUX_TIMEOUT: Duration = Duration::from_secs(120);
const SCHEMA_VERSION: u32 = 1;
const MAX_CHUNK_BYTES: u64 = 8 * 1024 * 1024;
const MAX_CHUNKS: u32 = 100_000;
const MAX_SESSIONS: usize = 1_000;
const MAX_MANIFEST_BYTES: usize = 32 * 1024;
const MAX_PATH_BYTES: usize = 4096;
const COPY_BUFFER_BYTES: usize = 64 * 1024;
const CONTAINER_PREFIX_BYTES: usize = 4096;
const CONTAINER_WARNING: &str =
    "Container tail completeness and decodability have not been verified.";
const INTERRUPTED_WARNING: &str =
    "Capture may have been interrupted: uncheckpointed audio and final container data may be missing.";

// The app is single-instance; serialize journal transitions without a crash-stale disk lock.
static RECORDING_OPERATIONS: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RecordingSourceKind {
    Microphone,
    Replay,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MeetingRecordingMetadata {
    pub title: String,
    pub created: String,
    pub mime_type: String,
    pub source_kind: RecordingSourceKind,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RecordingState {
    Capturing,
    Ready,
    Published,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingRecordingStatus {
    pub session_id: String,
    pub state: RecordingState,
    pub source_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizedMeetingRecording {
    pub session_id: String,
    pub original_path: String,
    pub sha256: String,
    pub byte_length: u64,
    pub chunk_count: u32,
    pub metadata: MeetingRecordingMetadata,
    pub warnings: Vec<String>,
    pub interrupted: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverableMeetingRecording {
    pub session_id: String,
    pub metadata: MeetingRecordingMetadata,
    pub chunk_count: u32,
    pub byte_length: u64,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverableMeetingRecordings {
    pub recordings: Vec<RecoverableMeetingRecording>,
    pub active_recording: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OriginalEvidence {
    file_name: String,
    sha256: String,
    byte_length: u64,
    chunk_count: u32,
    expected_chunks: Option<u32>,
    interrupted: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecordingManifest {
    schema_version: u32,
    session_id: String,
    metadata: MeetingRecordingMetadata,
    metadata_inferred: bool,
    state: RecordingState,
    original: Option<OriginalEvidence>,
    // Vault-relative so moving the vault does not invalidate its publication marker.
    source_path: Option<String>,
    warnings: Vec<String>,
}

impl RecordingManifest {
    fn capturing(
        session_id: String,
        metadata: MeetingRecordingMetadata,
        metadata_inferred: bool,
        warnings: Vec<String>,
    ) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            session_id,
            metadata,
            metadata_inferred,
            state: RecordingState::Capturing,
            original: None,
            source_path: None,
            warnings,
        }
    }

    fn status(&self) -> MeetingRecordingStatus {
        MeetingRecordingStatus {
            session_id: self.session_id.clone(),
            state: self.state,
            source_path: self.source_path.clone(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Container {
    Webm,
    Mp4,
}

impl Container {
    fn file_name(self) -> &'static str {
        match self {
            Self::Webm => "original.webm",
            Self::Mp4 => "original.m4a",
        }
    }

    fn mime_type(self) -> &'static str {
        match self {
            Self::Webm => "audio/webm",
            Self::Mp4 => "audio/mp4",
        }
    }
}

fn validate_metadata(metadata: &MeetingRecordingMetadata) -> Result<Container, String> {
    if metadata.title.trim().is_empty()
        || metadata.title.len() > 512
        || metadata.title.chars().any(char::is_control)
    {
        return Err("Recording title must contain 1-512 bytes without control characters".into());
    }
    if metadata.created.is_empty() || metadata.created.len() > 64 {
        return Err("Recording created time must be an ISO/RFC3339 timestamp of at most 64 bytes".into());
    }
    DateTime::parse_from_rfc3339(&metadata.created)
        .map_err(|_| "Recording created time must be an ISO/RFC3339 timestamp with a timezone")?;
    let mime = &metadata.mime_type;
    if mime.is_empty()
        || mime.len() > 128
        || !mime.is_ascii()
        || mime.chars().any(char::is_control)
        || mime.trim() != mime
    {
        return Err("Invalid recording MIME type".into());
    }
    let mut parts = mime.split(';');
    let container = match parts.next().unwrap_or("").trim().to_ascii_lowercase().as_str() {
        "audio/webm" => Container::Webm,
        "audio/mp4" | "audio/x-m4a" => Container::Mp4,
        _ => return Err("Recording MIME must be audio/webm, audio/mp4 or audio/x-m4a".into()),
    };
    if let Some(parameter) = parts.next() {
        let (name, value) = parameter.trim().split_once('=').ok_or("Invalid MIME codec parameter")?;
        let value = value.trim();
        let codec = if value.starts_with('"') && value.ends_with('"') && value.len() >= 2 {
            &value[1..value.len() - 1]
        } else {
            value
        };
        let supported = match container {
            Container::Webm => codec.eq_ignore_ascii_case("opus"),
            Container::Mp4 => ["mp4a.40.2", "mp4a.40.5", "mp4a.40.29"]
                .iter()
                .any(|supported| codec.eq_ignore_ascii_case(supported)),
        };
        if !name.trim().eq_ignore_ascii_case("codecs") || !supported || parts.next().is_some() {
            return Err("Unsupported recording MIME codec or parameter".into());
        }
    }
    Ok(container)
}

fn session_id(raw: &str) -> Result<String, String> {
    if raw.len() != 36 {
        return Err("Recording session ID must be a hyphenated UUID".into());
    }
    let id = Uuid::parse_str(raw).map_err(|_| "Invalid recording session ID")?;
    let normalized = id.to_string();
    if !normalized.eq_ignore_ascii_case(raw) {
        return Err("Recording session ID must be a hyphenated UUID".into());
    }
    Ok(normalized)
}

fn validate_raw_path(raw: &str) -> Result<(), String> {
    if raw.trim().is_empty() || raw.len() > MAX_PATH_BYTES || raw.contains('\0') {
        return Err("Path must contain 1-4096 bytes without NUL characters".into());
    }
    Ok(())
}

fn validate_relative_path(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty()
        || path.components().any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Recording paths must stay inside the vault without traversal".into());
    }
    Ok(())
}

fn inspect(path: &Path) -> Result<Option<Metadata>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(format!("Recording paths cannot be symlinks: {}", path.display()))
        }
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Cannot inspect {}: {error}", path.display())),
    }
}

/// Recordings hold meeting audio and voice data. A vault can be a git repository with a
/// remote, so the storage folder ignores its own content: nothing in it is ever committed.
const PRIVATE_MARKER: &str = ".gitignore";
const IGNORE_ALL: &str = "# Memoria private data (audio, voices, ledger): never committed.\n*\n";

fn ignore_in_version_control(storage: &Path) -> Result<(), String> {
    let marker = storage.join(PRIVATE_MARKER);
    if inspect(&marker)?.is_none() {
        fs::write(&marker, IGNORE_ALL).map_err(|error| format!("Cannot write {}: {error}", marker.display()))?;
    }
    Ok(())
}

fn ensure_directory(path: &Path, create: bool) -> Result<bool, String> {
    match inspect(path)? {
        Some(metadata) if !metadata.is_dir() => {
            return Err(format!("Recording path is not a directory: {}", path.display()));
        }
        Some(_) => {}
        None if !create => return Ok(false),
        None => match fs::create_dir(path) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                if !inspect(path)?.is_some_and(|metadata| metadata.is_dir()) {
                    return Err(format!("Recording path is not a directory: {}", path.display()));
                }
            }
            Err(error) => return Err(format!("Cannot create {}: {error}", path.display())),
        },
    }
    if create {
        if let Some(parent) = path.parent() {
            sync_directory(parent)?;
        }
    }
    Ok(true)
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), String> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("Cannot sync recording directory {}: {error}", path.display()))
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn platform_warnings() -> Vec<String> {
    #[cfg(unix)]
    {
        Vec::new()
    }
    #[cfg(not(unix))]
    {
        vec!["Directory-entry fsync is unavailable on this platform; file bytes are synced before publication.".into()]
    }
}

fn same_file(left: &Metadata, right: &Metadata) -> Result<bool, String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if left.dev() != right.dev() || left.ino() != right.ino() {
            return Ok(false);
        }
    }
    Ok(left.is_file()
        && right.is_file()
        && left.len() == right.len()
        && left.modified().map_err(|error| format!("Cannot inspect file modification time: {error}"))?
            == right.modified().map_err(|error| format!("Cannot inspect file modification time: {error}"))?)
}

fn open_regular_file(path: &Path) -> Result<(File, Metadata), String> {
    let before = inspect(path)?.ok_or_else(|| format!("Recording file is missing: {}", path.display()))?;
    if !before.is_file() {
        return Err(format!("Recording path is not a regular file: {}", path.display()));
    }
    let file = File::open(path).map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
    verify_file(path, &file, &before)?;
    Ok((file, before))
}

fn verify_file(path: &Path, file: &File, before: &Metadata) -> Result<(), String> {
    let opened = file.metadata().map_err(|error| format!("Cannot inspect {}: {error}", path.display()))?;
    let current = inspect(path)?.ok_or_else(|| format!("Recording file disappeared: {}", path.display()))?;
    if !same_file(before, &opened)? || !same_file(before, &current)? {
        return Err(format!("Recording file changed during the operation: {}", path.display()));
    }
    Ok(())
}

struct RecordingStorage {
    root: PathBuf,
    requested_root: PathBuf,
}

impl RecordingStorage {
    fn new(requested_root: &Path) -> Result<Self, String> {
        let root = requested_root
            .canonicalize()
            .map_err(|error| format!("Recording vault is unavailable: {error}"))?;
        if !root.is_dir() {
            return Err("Recording vault is not a directory".into());
        }
        let requested_root = if requested_root.is_absolute() {
            requested_root.to_path_buf()
        } else {
            std::env::current_dir()
                .map_err(|error| format!("Cannot resolve recording vault path: {error}"))?
                .join(requested_root)
        };
        Ok(Self { root, requested_root })
    }

    fn directory(&self, id: &str, create: bool) -> Result<PathBuf, String> {
        let storage = self.root.join(STORAGE_NAME);
        if !ensure_directory(&storage, create)? {
            return Err(format!("Recording storage is missing for session {id}"));
        }
        if create {
            ignore_in_version_control(&storage)?;
        }
        let directory = storage.join(id);
        if !ensure_directory(&directory, create)? {
            return Err(format!("Recording session directory is missing: {id}"));
        }
        Ok(directory)
    }

    fn vault_file(&self, raw: &str) -> Result<PathBuf, String> {
        validate_raw_path(raw)?;
        let expanded = PathBuf::from(super::expand_tilde(raw).into_owned());
        let relative = if expanded.is_absolute() {
            expanded
                .strip_prefix(&self.root)
                .or_else(|_| expanded.strip_prefix(&self.requested_root))
                .map_err(|_| "Recording source path must stay inside the vault")?
        } else {
            expanded.as_path()
        };
        validate_relative_path(relative)?;
        let mut path = self.root.clone();
        for component in relative.components() {
            path.push(component);
            inspect(&path)?.ok_or_else(|| format!("Recording source path is missing: {}", path.display()))?;
        }
        open_regular_file(&path)?;
        Ok(path)
    }

    fn begin(&self, raw_id: &str, metadata: MeetingRecordingMetadata) -> Result<MeetingRecordingStatus, String> {
        let id = session_id(raw_id)?;
        validate_metadata(&metadata)?;
        let directory = self.directory(&id, true)?;
        if let Some(existing) = read_manifest(&directory, &id)? {
            if existing.metadata != metadata {
                return Err(format!("Recording metadata already exists with different values: {id}"));
            }
            sync_manifest(&directory)?;
            return Ok(existing.status());
        }
        let inventory = scan_chunks(&directory)?;
        if inventory.chunk_count != 0 || inventory.webm_original || inventory.mp4_original {
            return Err(format!(
                "Session {id} already contains recording evidence without metadata; recover it instead of beginning a new capture"
            ));
        }
        let manifest = RecordingManifest::capturing(id, metadata, false, Vec::new());
        write_manifest(&directory, &manifest, None)?;
        Ok(manifest.status())
    }

    fn finalize(&self, raw_id: &str, expected_chunks: Option<u32>) -> Result<FinalizedMeetingRecording, String> {
        let id = session_id(raw_id)?;
        let directory = self.directory(&id, false)?;
        let inventory = scan_chunks(&directory)?;
        inventory.require_sequence()?;
        if let Some(expected) = expected_chunks {
            if expected != inventory.chunk_count {
                return Err(format!(
                    "Expected exactly {expected} durable audio chunks, found {}; a missing final chunk is not a complete recording",
                    inventory.chunk_count
                ));
            }
        }
        let manifest = match read_manifest(&directory, &id)? {
            Some(manifest) => manifest,
            None => {
                let manifest = infer_manifest(&directory, &id, &inventory)?;
                write_manifest(&directory, &manifest, None)?;
                manifest
            }
        };
        let container = validate_metadata(&manifest.metadata)?;
        if (container == Container::Webm && inventory.mp4_original)
            || (container == Container::Mp4 && inventory.webm_original)
        {
            return Err(format!("A conflicting original container already exists for session {id}"));
        }
        let (staged, sha256, byte_length, detected) = assemble(&directory, &inventory)?;
        if detected != container {
            return Err(format!(
                "Recording bytes identify {}, conflicting with manifest MIME {}",
                detected.mime_type(), manifest.metadata.mime_type
            ));
        }
        let after = scan_chunks(&self.directory(&id, false)?)?;
        if !inventory.same_chunks(&after) {
            return Err("Audio checkpoints changed during assembly; finish and drain capture before retrying".into());
        }
        let evidence = if let Some(existing) = &manifest.original {
            if existing.sha256 != sha256
                || existing.byte_length != byte_length
                || existing.chunk_count != inventory.chunk_count
                || existing.file_name != container.file_name()
            {
                return Err(format!("Durable checkpoints conflict with finalized original evidence: {id}"));
            }
            existing.clone()
        } else {
            OriginalEvidence {
                file_name: container.file_name().into(),
                sha256,
                byte_length,
                chunk_count: inventory.chunk_count,
                expected_chunks,
                interrupted: expected_chunks.is_none() || manifest.metadata_inferred,
            }
        };
        let original = directory.join(&evidence.file_name);
        publish_original(staged, &original, &evidence)?;
        let mut ready = manifest.clone();
        ready.original = Some(evidence.clone());
        if ready.state == RecordingState::Capturing {
            ready.state = RecordingState::Ready;
        }
        write_manifest(&self.directory(&id, false)?, &ready, Some(&manifest)).map_err(|error| {
            format!(
                "Original audio was published at {}, but the recording journal update failed: {error}. Retry finalization; the identical original will be retained",
                original.display()
            )
        })?;
        let warnings = recording_warnings(&ready, &inventory);
        Ok(FinalizedMeetingRecording {
            session_id: id,
            original_path: path_string(&original)?,
            sha256: evidence.sha256,
            byte_length: evidence.byte_length,
            chunk_count: evidence.chunk_count,
            metadata: ready.metadata,
            warnings,
            interrupted: evidence.interrupted,
        })
    }

    fn list(&self, active_recording: bool) -> Result<RecoverableMeetingRecordings, String> {
        if active_recording {
            return Ok(RecoverableMeetingRecordings { recordings: Vec::new(), active_recording: true });
        }
        let storage = self.root.join(STORAGE_NAME);
        if !ensure_directory(&storage, false)? {
            return Ok(RecoverableMeetingRecordings { recordings: Vec::new(), active_recording: false });
        }
        let mut candidates: Vec<(DateTime<FixedOffset>, RecoverableMeetingRecording)> = Vec::new();
        let entries = fs::read_dir(&storage)
            .map_err(|error| format!("Cannot list recording storage {}: {error}", storage.display()))?;
        for (index, entry) in entries.enumerate() {
            if index >= MAX_SESSIONS {
                return Err(format!("Recording storage exceeds the {MAX_SESSIONS}-session listing limit"));
            }
            let entry = entry.map_err(|error| format!("Cannot read recording storage entry: {error}"))?;
            let name = entry.file_name();
            let name = name.to_str().ok_or("Recording session directory name is not UTF-8")?;
            if name == PRIVATE_MARKER {
                continue;
            }
            let id = session_id(name).map_err(|error| format!("Invalid recording storage entry {name}: {error}"))?;
            if id != name {
                return Err(format!("Recording directory must use its canonical UUID: {name}"));
            }
            let directory = self.directory(&id, false)?;
            let existing = read_manifest(&directory, &id)?;
            if existing.as_ref().is_some_and(|manifest| manifest.state == RecordingState::Published) {
                continue;
            }
            let inventory = scan_chunks(&directory)?;
            if inventory.chunk_count == 0 {
                if existing.as_ref().is_some_and(|manifest| manifest.state == RecordingState::Capturing)
                    && !inventory.webm_original
                    && !inventory.mp4_original
                {
                    continue;
                }
                return Err(format!("Session {id} has no durable audio checkpoints; its recording evidence cannot be recovered"));
            }
            let manifest = match existing {
                Some(manifest) => manifest,
                None => infer_manifest(&directory, &id, &inventory)?,
            };
            let created = DateTime::parse_from_rfc3339(&manifest.metadata.created)
                .map_err(|error| format!("Invalid recording time for {id}: {error}"))?;
            candidates.push((created, RecoverableMeetingRecording {
                session_id: id,
                metadata: manifest.metadata.clone(),
                chunk_count: inventory.chunk_count,
                byte_length: inventory.byte_length,
                warnings: recording_warnings(&manifest, &inventory),
            }));
        }
        candidates.sort_by(|left, right| {
            right.0.cmp(&left.0).then_with(|| left.1.session_id.cmp(&right.1.session_id))
        });
        Ok(RecoverableMeetingRecordings {
            recordings: candidates.into_iter().map(|(_, candidate)| candidate).collect(),
            active_recording: false,
        })
    }

    fn complete(&self, raw_id: &str, source_path: &str) -> Result<MeetingRecordingStatus, String> {
        let id = session_id(raw_id)?;
        let directory = self.directory(&id, false)?;
        let manifest = read_manifest(&directory, &id)?
            .ok_or("Recording metadata is missing; finalize the recording before completing publication")?;
        let evidence = manifest.original.as_ref()
            .ok_or("Recording has not been finalized; finalize it before completing publication")?;
        let original = self.vault_file(&path_string(&directory.join(&evidence.file_name))?)?;
        verify_original(&original, evidence)?;
        let source = self.vault_file(source_path)?;
        let relative_source = path_string(
            source.strip_prefix(&self.root).map_err(|_| "Recording source path must stay inside the vault")?
        )?;
        if let Some(existing) = &manifest.source_path {
            if existing != &relative_source {
                return Err("Recording is already published with a different source path".into());
            }
        }
        let mut published = manifest.clone();
        published.state = RecordingState::Published;
        published.source_path = Some(relative_source);
        write_manifest(&self.directory(&id, false)?, &published, Some(&manifest))?;
        Ok(published.status())
    }

    /// The file the meeting player loads. A browser recording (MediaRecorder WebM) states no duration and has no
    /// index, so a player can neither show its length nor seek in it; FFmpeg copies the same audio packets into a
    /// WebM that has both. The original evidence is never touched. Any other recording, or a WebM that FFmpeg
    /// cannot copy, plays as it is.
    fn playback(&self, raw_audio: &str, ffmpeg: &Path) -> Result<PathBuf, String> {
        let original = self.vault_file(raw_audio)?;
        let extension = original.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
        if !PLAYBACK_EXTENSIONS.contains(&extension.as_str()) {
            return Err("Only recordings can be played".into());
        }
        let Some(directory) = self.browser_recording_directory(&original) else {
            return Ok(original);
        };
        // An existing copy is used only when it is a plain file; a link or anything else is never served.
        let playable = directory.join(PLAYBACK_NAME);
        let usable = |path: &Path| open_regular_file(path).is_ok();
        if !matches!(inspect(&playable), Ok(None)) {
            return Ok(if usable(&playable) { playable } else { original });
        }
        let Ok(staged) = remux(ffmpeg, &original, &directory) else {
            return Ok(original);
        };
        match staged.persist_noclobber(&playable) {
            Ok(_) => Ok(playable),
            // Another window copied it first.
            Err(error) if error.error.kind() == ErrorKind::AlreadyExists && usable(&playable) => Ok(playable),
            Err(_) => Ok(original),
        }
    }

    /// The session folder of an original browser recording, `.memoria-recordings/<session>/original.webm`.
    fn browser_recording_directory(&self, original: &Path) -> Option<PathBuf> {
        let directory = original.parent()?;
        let name = directory.file_name()?.to_str()?;
        let canonical = session_id(name).is_ok_and(|id| id == name);
        (canonical
            && original.file_name()? == Container::Webm.file_name()
            && directory.parent()? == self.root.join(STORAGE_NAME))
            .then(|| directory.to_path_buf())
    }
}

fn ffmpeg_path() -> PathBuf {
    std::env::var_os("MEMORIA_FFMPEG")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/opt/homebrew/bin/ffmpeg"))
}

/// FFmpeg copies the audio packets unchanged into a staged WebM; writing to a regular file lets it add the duration
/// and the cue index that a recorder streaming its output cannot.
fn remux(ffmpeg: &Path, original: &Path, directory: &Path) -> Result<NamedTempFile, String> {
    let staged = Builder::new().prefix(".playback-").suffix(".tmp").tempfile_in(directory)
        .map_err(|error| format!("Cannot stage a playable copy: {error}"))?;
    let mut child = Command::new(ffmpeg)
        .args(["-nostdin", "-v", "error", "-y", "-i"])
        .arg(original)
        .args(["-map", "0:a:0", "-c", "copy", "-f", "webm"])
        .arg(staged.path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Cannot run FFmpeg at {}: {error}", ffmpeg.display()))?;
    let deadline = Instant::now() + REMUX_TIMEOUT;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|error| format!("Cannot wait for FFmpeg: {error}"))? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("FFmpeg did not finish copying the recording in time".into());
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    if !status.success() {
        return Err(format!("FFmpeg could not copy the recording: {status}"));
    }
    let mut prefix = Vec::with_capacity(CONTAINER_PREFIX_BYTES);
    File::open(staged.path())
        .and_then(|file| file.take(CONTAINER_PREFIX_BYTES as u64).read_to_end(&mut prefix))
        .map_err(|error| format!("Cannot read the playable copy: {error}"))?;
    if detect_container(&prefix)? != Container::Webm {
        return Err("FFmpeg did not write a WebM recording".into());
    }
    Ok(staged)
}

fn path_string(path: &Path) -> Result<String, String> {
    path.to_str().map(str::to_owned).ok_or_else(|| format!("Recording path is not UTF-8: {}", path.display()))
}

fn validate_manifest(manifest: &RecordingManifest, id: &str) -> Result<(), String> {
    if manifest.schema_version != SCHEMA_VERSION || manifest.session_id != id {
        return Err("Recording journal version or session identity does not match".into());
    }
    let container = validate_metadata(&manifest.metadata)?;
    if manifest.warnings.len() > 8 || manifest.warnings.iter().any(|warning| warning.len() > 1024) {
        return Err("Recording journal warnings exceed their size limit".into());
    }
    match (&manifest.state, &manifest.original, &manifest.source_path) {
        (RecordingState::Capturing, None, None)
        | (RecordingState::Ready, Some(_), None)
        | (RecordingState::Published, Some(_), Some(_)) => {}
        _ => return Err("Recording journal has an inconsistent lifecycle state".into()),
    }
    if let Some(original) = &manifest.original {
        if original.file_name != container.file_name()
            || original.sha256.len() != 64
            || !original.sha256.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            || original.chunk_count == 0
            || original.chunk_count > MAX_CHUNKS
            || original.byte_length == 0
            || original.byte_length > u64::from(original.chunk_count) * MAX_CHUNK_BYTES
            || original.expected_chunks.is_some_and(|expected| expected != original.chunk_count)
            || ((!original.interrupted) && (original.expected_chunks.is_none() || manifest.metadata_inferred))
        {
            return Err("Recording journal has invalid original evidence".into());
        }
    }
    if let Some(source) = &manifest.source_path {
        validate_raw_path(source)?;
        validate_relative_path(Path::new(source))?;
    }
    Ok(())
}

fn read_manifest(directory: &Path, id: &str) -> Result<Option<RecordingManifest>, String> {
    let path = directory.join(MANIFEST_NAME);
    if inspect(&path)?.is_none() {
        return Ok(None);
    }
    let (mut file, metadata) = open_regular_file(&path)?;
    if metadata.len() > MAX_MANIFEST_BYTES as u64 {
        return Err(format!("Recording journal exceeds 32 KB: {}", path.display()));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    Read::by_ref(&mut file).take((MAX_MANIFEST_BYTES + 1) as u64).read_to_end(&mut bytes)
        .map_err(|error| format!("Cannot read recording journal {}: {error}", path.display()))?;
    if bytes.len() > MAX_MANIFEST_BYTES {
        return Err(format!("Recording journal exceeds 32 KB: {}", path.display()));
    }
    verify_file(&path, &file, &metadata)?;
    let manifest: RecordingManifest = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Invalid recording journal {}: {error}", path.display()))?;
    validate_manifest(&manifest, id)
        .map_err(|error| format!("Invalid recording journal {}: {error}", path.display()))?;
    Ok(Some(manifest))
}

fn sync_manifest(directory: &Path) -> Result<(), String> {
    let path = directory.join(MANIFEST_NAME);
    let (file, _) = open_regular_file(&path)?;
    file.sync_all().map_err(|error| format!("Cannot sync recording journal {}: {error}", path.display()))?;
    sync_directory(directory)
}

fn write_manifest(
    directory: &Path,
    manifest: &RecordingManifest,
    previous: Option<&RecordingManifest>,
) -> Result<(), String> {
    validate_manifest(manifest, &manifest.session_id)?;
    let current = read_manifest(directory, &manifest.session_id)?;
    if current.as_ref() != previous {
        if current.as_ref() == Some(manifest) {
            return sync_manifest(directory);
        }
        return Err("Recording journal changed or contains conflicting metadata; no evidence was overwritten".into());
    }
    if previous == Some(manifest) {
        return sync_manifest(directory);
    }
    #[cfg(test)]
    if manifest.original.is_some() && FAIL_JOURNAL_UPDATE.with(|failure| failure.replace(false)) {
        return Err("Injected recording journal update failure".into());
    }
    let bytes = serde_json::to_vec_pretty(manifest)
        .map_err(|error| format!("Cannot serialize recording journal: {error}"))?;
    if bytes.len() > MAX_MANIFEST_BYTES {
        return Err("Recording journal exceeds 32 KB".into());
    }
    let mut staged = Builder::new().prefix(".recording-").suffix(".tmp").tempfile_in(directory)
        .map_err(|error| format!("Cannot stage recording journal: {error}"))?;
    staged.write_all(&bytes).and_then(|_| staged.as_file().sync_all())
        .map_err(|error| format!("Cannot write and sync recording journal: {error}"))?;
    if read_manifest(directory, &manifest.session_id)?.as_ref() != previous {
        return Err("Recording journal changed during publication; no evidence was overwritten".into());
    }
    let destination = directory.join(MANIFEST_NAME);
    if previous.is_some() {
        staged.persist(&destination)
            .map_err(|error| format!("Cannot publish recording journal {}: {}", destination.display(), error.error))?;
    } else {
        match staged.persist_noclobber(&destination) {
            Ok(_) => {}
            Err(error) if error.error.kind() == ErrorKind::AlreadyExists => {
                if read_manifest(directory, &manifest.session_id)?.as_ref() != Some(manifest) {
                    return Err("Recording metadata already exists with conflicting values".into());
                }
            }
            Err(error) => return Err(format!("Cannot publish recording journal: {}", error.error)),
        }
    }
    sync_directory(directory)
}

#[derive(Debug)]
struct ChunkInventory {
    chunk_count: u32,
    byte_length: u64,
    highest_index: Option<u32>,
    has_zero: bool,
    temporary_files: u32,
    webm_original: bool,
    mp4_original: bool,
}

impl ChunkInventory {
    fn sequence_error(&self) -> Option<String> {
        if self.chunk_count == 0 {
            Some("Recording has no durable audio chunks".into())
        } else if !self.has_zero {
            Some("Recording is missing chunk index 0; no original can be assembled".into())
        } else if self.highest_index.map(|index| u64::from(index) + 1) != Some(u64::from(self.chunk_count)) {
            Some(format!(
                "Recording audio sequence has gaps: {} chunks with highest index {}; no original can be assembled",
                self.chunk_count, self.highest_index.unwrap_or(0)
            ))
        } else {
            None
        }
    }

    fn require_sequence(&self) -> Result<(), String> {
        match self.sequence_error() {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    fn same_chunks(&self, other: &Self) -> bool {
        self.chunk_count == other.chunk_count
            && self.byte_length == other.byte_length
            && self.highest_index == other.highest_index
            && self.has_zero == other.has_zero
    }
}

fn scan_chunks(directory: &Path) -> Result<ChunkInventory, String> {
    let mut inventory = ChunkInventory {
        chunk_count: 0,
        byte_length: 0,
        highest_index: None,
        has_zero: false,
        temporary_files: 0,
        webm_original: false,
        mp4_original: false,
    };
    let entries = fs::read_dir(directory)
        .map_err(|error| format!("Cannot list recording session {}: {error}", directory.display()))?;
    for (entry_count, entry) in entries.enumerate() {
        if entry_count > MAX_CHUNKS as usize + 1024 {
            return Err(format!("Recording session has too many directory entries: {}", directory.display()));
        }
        let entry = entry.map_err(|error| format!("Cannot read recording session entry: {error}"))?;
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_str().ok_or("Recording checkpoint name is not UTF-8")?;
        let metadata = inspect(&path)?.ok_or_else(|| format!("Recording entry disappeared: {}", path.display()))?;
        if !metadata.is_file() {
            return Err(format!("Unexpected non-file recording entry: {}", path.display()));
        }
        match name {
            // Neither the journal nor the playable copy is an audio checkpoint.
            MANIFEST_NAME | PLAYBACK_NAME => continue,
            "original.webm" => {
                open_regular_file(&path)?;
                inventory.webm_original = true;
                continue;
            }
            "original.m4a" => {
                open_regular_file(&path)?;
                inventory.mp4_original = true;
                continue;
            }
            _ if name.ends_with(".tmp") => {
                inventory.temporary_files += 1;
                continue;
            }
            _ => {}
        }
        let digits = name.strip_suffix(".audio")
            .filter(|digits| digits.len() == 10 && digits.bytes().all(|byte| byte.is_ascii_digit()))
            .ok_or_else(|| format!("Invalid recording checkpoint filename: {}", path.display()))?;
        let index: u32 = digits.parse()
            .map_err(|_| format!("Recording checkpoint index is outside the u32 range: {}", path.display()))?;
        if metadata.len() == 0 || metadata.len() > MAX_CHUNK_BYTES {
            return Err(format!("Audio checkpoint must contain 1-8 MB of bytes: {}", path.display()));
        }
        open_regular_file(&path)?;
        inventory.chunk_count += 1;
        if inventory.chunk_count > MAX_CHUNKS {
            return Err(format!("Recording exceeds the {MAX_CHUNKS}-chunk recovery limit"));
        }
        inventory.byte_length = inventory.byte_length.checked_add(metadata.len())
            .ok_or("Recording byte length overflow")?;
        inventory.has_zero |= index == 0;
        inventory.highest_index = Some(inventory.highest_index.map_or(index, |highest| highest.max(index)));
    }
    Ok(inventory)
}

fn recording_warnings(manifest: &RecordingManifest, inventory: &ChunkInventory) -> Vec<String> {
    let mut warnings = manifest.warnings.clone();
    warnings.extend(platform_warnings());
    if inventory.temporary_files != 0 {
        warnings.push(format!(
            "{} unpublished temporary file(s) were ignored; only numbered .audio checkpoints count",
            inventory.temporary_files
        ));
    }
    if let Some(error) = inventory.sequence_error() {
        warnings.push(error);
    }
    if manifest.state == RecordingState::Capturing
        || manifest.original.as_ref().is_some_and(|original| original.interrupted)
    {
        warnings.push(INTERRUPTED_WARNING.into());
    }
    if let Some(original) = &manifest.original {
        if original.chunk_count != inventory.chunk_count || original.byte_length != inventory.byte_length {
            warnings.push("Checkpoint counts differ from finalized evidence; finalization will check and refuse conflicting bytes.".into());
        }
        let original_exists = match original.file_name.as_str() {
            "original.webm" => inventory.webm_original,
            _ => inventory.mp4_original,
        };
        if !original_exists {
            warnings.push("The finalized original is missing; durable checkpoints remain available for exact reassembly.".into());
        }
    }
    warnings.push(CONTAINER_WARNING.into());
    warnings
}

fn read_ordered_prefix(directory: &Path, inventory: &ChunkInventory) -> Result<Vec<u8>, String> {
    inventory.require_sequence()?;
    let mut prefix = Vec::with_capacity(CONTAINER_PREFIX_BYTES);
    for index in 0..inventory.chunk_count {
        let path = directory.join(format!("{index:010}.audio"));
        let (mut file, metadata) = open_regular_file(&path)?;
        let remaining = CONTAINER_PREFIX_BYTES - prefix.len();
        Read::by_ref(&mut file).take(remaining as u64).read_to_end(&mut prefix)
            .map_err(|error| format!("Cannot inspect recording container {}: {error}", path.display()))?;
        verify_file(&path, &file, &metadata)?;
        if prefix.len() == CONTAINER_PREFIX_BYTES {
            break;
        }
    }
    Ok(prefix)
}

fn infer_manifest(
    directory: &Path,
    id: &str,
    inventory: &ChunkInventory,
) -> Result<RecordingManifest, String> {
    let prefix = read_ordered_prefix(directory, inventory)
        .map_err(|error| format!("Legacy recording {id} has no recording.json: {error}"))?;
    let container = detect_container(&prefix)
        .map_err(|error| format!("Legacy recording {id} has no recording.json; cannot reliably infer its container: {error}"))?;
    let first = directory.join("0000000000.audio");
    let (_, metadata) = open_regular_file(&first)?;
    let (created, time_warning) = match metadata.created() {
        Ok(created) => (created, "The recovered created time is the first checkpoint's filesystem creation time, not verified capture time."),
        Err(error) if error.kind() == ErrorKind::Unsupported => (
            metadata.modified().map_err(|error| format!("Cannot infer legacy recording time: {error}"))?,
            "Filesystem creation time is unavailable; the recovered created time uses the first checkpoint's modification time, not verified capture time.",
        ),
        Err(error) => return Err(format!("Cannot read legacy recording creation time: {error}")),
    };
    Ok(RecordingManifest::capturing(
        id.into(),
        MeetingRecordingMetadata {
            title: format!("Recovered recording {id}"),
            created: DateTime::<Utc>::from(created).to_rfc3339_opts(SecondsFormat::Millis, true),
            mime_type: container.mime_type().into(),
            source_kind: RecordingSourceKind::Microphone,
        },
        true,
        vec![
            "Legacy recording has no recording.json: title and microphone source kind are inferred, not verified capture metadata.".into(),
            time_warning.into(),
            "MIME is inferred from the container header only; audio tracks and codecs have not been verified.".into(),
        ],
    ))
}

fn ebml_integer(bytes: &[u8], size: bool) -> Result<(u64, usize), String> {
    let first = *bytes.first().ok_or("Incomplete WebM EBML header")?;
    if first == 0 {
        return Err("Invalid WebM EBML integer".into());
    }
    let length = first.leading_zeros() as usize + 1;
    if length > if size { 8 } else { 4 } || bytes.len() < length {
        return Err("Incomplete or invalid WebM EBML integer".into());
    }
    let mut value = if size { u64::from(first & (0x7f >> (length - 1))) } else { u64::from(first) };
    for byte in &bytes[1..length] {
        value = (value << 8) | u64::from(*byte);
    }
    if size && value == (1u64 << (7 * length)) - 1 {
        return Err("Unknown-length WebM EBML header cannot identify its container".into());
    }
    Ok((value, length))
}

fn detect_container(prefix: &[u8]) -> Result<Container, String> {
    if prefix.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        let (size, size_bytes) = ebml_integer(&prefix[4..], true)?;
        let start = 4 + size_bytes;
        let end = start.checked_add(usize::try_from(size).map_err(|_| "WebM EBML header is too large")?)
            .filter(|end| *end <= prefix.len())
            .ok_or("WebM EBML header is incomplete or exceeds the 4096-byte inspection limit")?;
        let mut offset = start;
        let mut webm = false;
        while offset < end {
            let (id, id_bytes) = ebml_integer(&prefix[offset..end], false)?;
            offset += id_bytes;
            let (length, length_bytes) = ebml_integer(&prefix[offset..end], true)?;
            offset += length_bytes;
            let next = offset.checked_add(usize::try_from(length).map_err(|_| "WebM header element is too large")?)
                .filter(|next| *next <= end)
                .ok_or("Incomplete WebM EBML header element")?;
            if id == 0x4282 {
                if &prefix[offset..next] != b"webm" || webm {
                    return Err("EBML DocType does not uniquely identify WebM".into());
                }
                webm = true;
            }
            offset = next;
        }
        return if webm { Ok(Container::Webm) } else { Err("EBML header has no WebM DocType".into()) };
    }
    if prefix.len() >= 16 && &prefix[4..8] == b"ftyp" {
        let box_size = u32::from_be_bytes(prefix[..4].try_into().map_err(|_| "Incomplete MP4 header")?);
        let (box_size, brand_start) = if box_size == 1 {
            if prefix.len() < 24 {
                return Err("Incomplete extended MP4 ftyp box".into());
            }
            (u64::from_be_bytes(prefix[8..16].try_into().map_err(|_| "Incomplete MP4 header")?), 16)
        } else {
            (u64::from(box_size), 8)
        };
        let end = usize::try_from(box_size)
            .ok().filter(|end| *end >= brand_start + 8 && *end <= prefix.len() && (*end - brand_start) % 4 == 0)
            .ok_or("MP4 ftyp box is incomplete or exceeds the 4096-byte inspection limit")?;
        let recognized = |brand: &[u8]| {
            matches!(brand, b"isom" | b"iso2" | b"iso3" | b"iso4" | b"iso5" | b"iso6" | b"mp41" | b"mp42" | b"M4A " | b"M4B " | b"cmfa")
        };
        if recognized(&prefix[brand_start..brand_start + 4])
            || prefix[brand_start + 8..end].chunks_exact(4).any(recognized)
        {
            return Ok(Container::Mp4);
        }
        return Err("MP4 ftyp box does not identify a supported MPEG-4 container".into());
    }
    Err("No verified WebM DocType or supported MPEG-4 ftyp header in durable checkpoints".into())
}

fn assemble(
    directory: &Path,
    inventory: &ChunkInventory,
) -> Result<(NamedTempFile, String, u64, Container), String> {
    let mut staged = Builder::new().prefix(".original-").suffix(".tmp").tempfile_in(directory)
        .map_err(|error| format!("Cannot stage original recording: {error}"))?;
    let mut buffer = [0u8; COPY_BUFFER_BYTES];
    let mut prefix = Vec::with_capacity(CONTAINER_PREFIX_BYTES);
    let mut hash = Sha256::new();
    let mut byte_length = 0u64;
    for index in 0..inventory.chunk_count {
        let path = directory.join(format!("{index:010}.audio"));
        let (mut file, metadata) = open_regular_file(&path)?;
        if metadata.len() == 0 || metadata.len() > MAX_CHUNK_BYTES {
            return Err(format!("Invalid audio checkpoint length: {}", path.display()));
        }
        let mut copied = 0u64;
        loop {
            let length = file.read(&mut buffer)
                .map_err(|error| format!("Cannot assemble audio checkpoint {}: {error}", path.display()))?;
            if length == 0 {
                break;
            }
            copied += length as u64;
            if copied > metadata.len() {
                return Err(format!("Audio checkpoint grew during assembly: {}", path.display()));
            }
            staged.write_all(&buffer[..length])
                .map_err(|error| format!("Cannot write original recording: {error}"))?;
            hash.update(&buffer[..length]);
            byte_length = byte_length.checked_add(length as u64).ok_or("Recording byte length overflow")?;
            let prefix_length = (CONTAINER_PREFIX_BYTES - prefix.len()).min(length);
            prefix.extend_from_slice(&buffer[..prefix_length]);
        }
        if copied != metadata.len() {
            return Err(format!("Audio checkpoint was truncated during assembly: {}", path.display()));
        }
        verify_file(&path, &file, &metadata)?;
    }
    if byte_length != inventory.byte_length {
        return Err("Audio checkpoint byte lengths changed during assembly".into());
    }
    let container = detect_container(&prefix)?;
    staged.as_file().sync_all().map_err(|error| format!("Cannot sync original recording: {error}"))?;
    Ok((staged, format!("{:x}", hash.finalize()), byte_length, container))
}

fn verify_original(path: &Path, expected: &OriginalEvidence) -> Result<(), String> {
    let (mut file, metadata) = open_regular_file(path)?;
    if metadata.len() != expected.byte_length {
        return Err(format!("Existing original has different bytes: {}", path.display()));
    }
    let mut buffer = [0u8; COPY_BUFFER_BYTES];
    let mut hash = Sha256::new();
    let mut length = 0u64;
    loop {
        let read = file.read(&mut buffer).map_err(|error| format!("Cannot verify original {}: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        length += read as u64;
        if length > expected.byte_length {
            return Err(format!("Existing original changed during verification: {}", path.display()));
        }
        hash.update(&buffer[..read]);
    }
    verify_file(path, &file, &metadata)?;
    if length != expected.byte_length || format!("{:x}", hash.finalize()) != expected.sha256 {
        return Err(format!("Existing original has different bytes or SHA-256: {}", path.display()));
    }
    file.sync_all().map_err(|error| format!("Cannot sync original {}: {error}", path.display()))
}

fn publish_original(staged: NamedTempFile, destination: &Path, evidence: &OriginalEvidence) -> Result<(), String> {
    if inspect(destination)?.is_some() {
        verify_original(destination, evidence)?;
    } else {
        match staged.persist_noclobber(destination) {
            Ok(_) => {}
            Err(error) if error.error.kind() == ErrorKind::AlreadyExists => verify_original(destination, evidence)?,
            Err(error) => return Err(format!("Cannot publish original {}: {}", destination.display(), error.error)),
        }
    }
    sync_directory(destination.parent().ok_or("Original recording has no parent directory")?)
}

async fn recording_work<T: Send + 'static>(
    vault_path: String,
    work: impl FnOnce(RecordingStorage) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    validate_raw_path(&vault_path)?;
    let boundary = super::vault::VaultBoundary::from_request(Some(&vault_path))?;
    let root = boundary.requested_root().to_path_buf();
    super::blocking::run_blocking(move || {
        let _operation = RECORDING_OPERATIONS.lock()
            .map_err(|_| "Recording operation lock is poisoned; restart before retrying")?;
        work(RecordingStorage::new(&root)?)
    }).await?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn begin_meeting_recording(
    vault_path: String,
    session_id: String,
    metadata: MeetingRecordingMetadata,
) -> Result<MeetingRecordingStatus, String> {
    recording_work(vault_path, move |storage| storage.begin(&session_id, metadata)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn finalize_meeting_recording(
    vault_path: String,
    session_id: String,
    expected_chunks: Option<u32>,
) -> Result<FinalizedMeetingRecording, String> {
    recording_work(vault_path, move |storage| storage.finalize(&session_id, expected_chunks)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_recoverable_recordings(
    app: tauri::AppHandle,
    vault_path: String,
) -> Result<RecoverableMeetingRecordings, String> {
    recording_work(vault_path, move |storage| {
        let recordings = storage.list(app.get_webview_window("meeting-hud").is_some())?;
        if app.get_webview_window("meeting-hud").is_some() {
            return storage.list(true);
        }
        Ok(recordings)
    }).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn complete_meeting_recording(
    vault_path: String,
    session_id: String,
    source_path: String,
) -> Result<MeetingRecordingStatus, String> {
    recording_work(vault_path, move |storage| storage.complete(&session_id, &source_path)).await
}

/// The path the meeting player should load for a recording, which the webview may then read. The vault is served to
/// the webview without its hidden folders, and recordings live in one, so each recording is allowed as it is opened.
/// Copying runs outside the recording lock: it only reads the finished original.
#[tauri::command(rename_all = "camelCase")]
pub async fn prepare_meeting_playback(
    app: tauri::AppHandle,
    vault_path: String,
    audio_path: String,
) -> Result<String, String> {
    validate_raw_path(&vault_path)?;
    let boundary = super::vault::VaultBoundary::from_request(Some(&vault_path))?;
    let root = boundary.requested_root().to_path_buf();
    let ffmpeg = ffmpeg_path();
    let path = super::blocking::run_blocking(move || RecordingStorage::new(&root)?.playback(&audio_path, &ffmpeg)).await??;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|error| format!("Cannot open the recording for playback: {error}"))?;
    path_string(&path)
}

#[cfg(test)]
thread_local! {
    static FAIL_JOURNAL_UPDATE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    const WEBM_HEADER: &[u8] = b"\x1a\x45\xdf\xa3\x87\x42\x82\x84webm";
    const MP4_HEADER: &[u8] = b"\x00\x00\x00\x18ftypM4A \x00\x00\x00\x00M4A isom";

    fn metadata() -> MeetingRecordingMetadata {
        MeetingRecordingMetadata {
            title: "Fictional recovery meeting".into(),
            created: "2026-11-02T00:00:00.000Z".into(),
            mime_type: "audio/webm;codecs=opus".into(),
            source_kind: RecordingSourceKind::Microphone,
        }
    }

    fn fixture() -> (TempDir, RecordingStorage, String) {
        let root = tempfile::tempdir().unwrap();
        let storage = RecordingStorage::new(root.path()).unwrap();
        let id = Uuid::new_v4().to_string();
        (root, storage, id)
    }

    fn chunk(storage: &RecordingStorage, id: &str, index: u32, bytes: &[u8]) -> PathBuf {
        let directory = storage.directory(id, true).unwrap();
        let path = directory.join(format!("{index:010}.audio"));
        fs::write(&path, bytes).unwrap();
        path
    }

    fn begin_with_audio(storage: &RecordingStorage, id: &str) -> Vec<u8> {
        storage.begin(id, metadata()).unwrap();
        let mut bytes = WEBM_HEADER.to_vec();
        bytes.extend_from_slice(b"fictional audio container payload");
        chunk(storage, id, 0, &bytes);
        bytes
    }

    fn manifest(storage: &RecordingStorage, id: &str) -> RecordingManifest {
        read_manifest(&storage.directory(id, false).unwrap(), id).unwrap().unwrap()
    }

    fn source(storage: &RecordingStorage) -> PathBuf {
        let directory = storage.root.join("sources");
        fs::create_dir(&directory).unwrap();
        let source = directory.join("fictional-source.md");
        fs::write(&source, "# Fictional recording source\n").unwrap();
        source
    }

    #[test]
    fn metadata_is_durable_idempotent_and_conflicts_are_preserved() {
        let (_root, storage, id) = fixture();
        let first = storage.begin(&id, metadata()).unwrap();
        assert_eq!(first.state, RecordingState::Capturing);
        let directory = storage.directory(&id, false).unwrap();
        let journal = directory.join(MANIFEST_NAME);
        let bytes = fs::read(&journal).unwrap();
        assert_eq!(manifest(&storage, &id).metadata, metadata());
        storage.begin(&id, metadata()).unwrap();
        assert_eq!(fs::read(&journal).unwrap(), bytes);
        let mut different = metadata();
        different.title = "Different fictional title".into();
        assert!(storage.begin(&id, different).unwrap_err().contains("different"));
        assert_eq!(fs::read(&journal).unwrap(), bytes);
        assert_eq!(scan_chunks(&directory).unwrap().chunk_count, 0);
    }

    #[test]
    fn metadata_and_session_validation_precedes_directory_creation() {
        let (_root, storage, id) = fixture();
        let mut invalid = metadata();
        for title in ["".to_string(), " ".to_string(), "x".repeat(513), "title\ncontrol".to_string()] {
            invalid.title = title;
            assert!(storage.begin(&id, invalid.clone()).is_err());
        }
        invalid = metadata();
        invalid.created = "2026-11-02".into();
        assert!(storage.begin(&id, invalid.clone()).is_err());
        invalid.created = "x".repeat(65);
        assert!(storage.begin(&id, invalid).is_err());
        for mime in ["audio/wav", "video/webm", "audio/webm;codecs=vorbis", "audio/mp4;codecs=opus", "audio/webm;codecs=opus;extra=1"] {
            invalid = metadata();
            invalid.mime_type = mime.into();
            assert!(storage.begin(&id, invalid.clone()).is_err(), "{mime}");
        }
        for bad_id in ["../outside", "00000000000000000000000000000000", "not-a-uuid"] {
            assert!(storage.begin(bad_id, metadata()).is_err());
        }
        assert!(!storage.root.join(STORAGE_NAME).exists());
    }

    #[test]
    fn serde_contract_uses_camel_case_and_rejects_unknown_fields_and_source_kinds() {
        let valid = json!({
            "title": "Fictional", "created": "2026-11-02T00:00:00Z",
            "mimeType": "audio/mp4", "sourceKind": "replay"
        });
        let parsed: MeetingRecordingMetadata = serde_json::from_value(valid.clone()).unwrap();
        assert_eq!(parsed.source_kind, RecordingSourceKind::Replay);
        assert_eq!(validate_metadata(&parsed).unwrap(), Container::Mp4);
        assert_eq!(serde_json::to_value(parsed).unwrap(), valid);
        let mut invalid = valid.clone();
        invalid["sourceKind"] = json!("system");
        assert!(serde_json::from_value::<MeetingRecordingMetadata>(invalid).is_err());
        let mut invalid = valid;
        invalid["unexpected"] = json!(true);
        assert!(serde_json::from_value::<MeetingRecordingMetadata>(invalid).is_err());
        let status = MeetingRecordingStatus { session_id: "id".into(), state: RecordingState::Capturing, source_path: None };
        assert_eq!(serde_json::to_value(status).unwrap(), json!({"sessionId":"id","state":"capturing","sourcePath":null}));
    }

    #[test]
    fn assembly_is_ordered_byte_exact_hashed_and_keeps_checkpoints() {
        let (_root, storage, id) = fixture();
        storage.begin(&id, metadata()).unwrap();
        chunk(&storage, &id, 2, b"third");
        chunk(&storage, &id, 0, WEBM_HEADER);
        chunk(&storage, &id, 1, b"second");
        let expected = [WEBM_HEADER, b"second", b"third"].concat();
        let result = storage.finalize(&id, Some(3)).unwrap();
        assert_eq!(fs::read(&result.original_path).unwrap(), expected);
        assert_eq!(result.sha256, format!("{:x}", Sha256::digest(&expected)));
        assert_eq!(result.byte_length, expected.len() as u64);
        assert_eq!(result.chunk_count, 3);
        assert_eq!(result.session_id, id);
        assert_eq!(result.metadata, metadata());
        assert!(!result.interrupted);
        assert!(Path::new(&result.original_path).is_absolute());
        assert!(result.warnings.iter().any(|warning| warning == CONTAINER_WARNING));
        assert_eq!(manifest(&storage, &id).state, RecordingState::Ready);
        assert_eq!(scan_chunks(&storage.directory(&id, false).unwrap()).unwrap().chunk_count, 3);
        let dto = serde_json::to_value(result).unwrap();
        assert!(dto.get("originalPath").is_some());
        assert!(dto.get("byteLength").is_some());
        assert!(dto.get("chunkCount").is_some());
    }

    #[test]
    fn assembly_streams_many_buffers_and_accepts_split_container_headers() {
        let (_root, storage, id) = fixture();
        storage.begin(&id, metadata()).unwrap();
        let mut expected = WEBM_HEADER.to_vec();
        expected.extend((0..(COPY_BUFFER_BYTES * 7 + 13)).map(|index| (index % 251) as u8));
        chunk(&storage, &id, 0, &expected[..3]);
        chunk(&storage, &id, 1, &expected[3..COPY_BUFFER_BYTES + 7]);
        chunk(&storage, &id, 2, &expected[COPY_BUFFER_BYTES + 7..]);
        let result = storage.finalize(&id, Some(3)).unwrap();
        assert_eq!(fs::read(&result.original_path).unwrap(), expected);
        assert_eq!(result.sha256, format!("{:x}", Sha256::digest(&expected)));
    }

    #[test]
    fn recording_storage_is_never_committed_and_its_marker_is_not_a_session() {
        let (_root, storage, id) = fixture();
        storage.begin(&id, metadata()).unwrap();
        let marker = storage.root.join(STORAGE_NAME).join(".gitignore");
        assert_eq!(fs::read_to_string(&marker).unwrap().lines().last(), Some("*"));
        assert!(storage.list(false).is_ok());
    }

    #[test]
    fn finalize_is_identical_after_restart_and_does_not_replace_original_or_journal() {
        let (root, storage, id) = fixture();
        let expected = begin_with_audio(&storage, &id);
        let first = storage.finalize(&id, Some(1)).unwrap();
        let original_metadata = fs::metadata(&first.original_path).unwrap();
        let directory = storage.directory(&id, false).unwrap();
        let journal = fs::read(directory.join(MANIFEST_NAME)).unwrap();
        let restarted = RecordingStorage::new(root.path()).unwrap();
        let retried = restarted.finalize(&id, None).unwrap();
        assert_eq!(first.sha256, retried.sha256);
        assert_eq!(first.original_path, retried.original_path);
        assert_eq!(first.byte_length, retried.byte_length);
        assert!(!retried.interrupted);
        assert_eq!(fs::read(&retried.original_path).unwrap(), expected);
        assert!(same_file(&original_metadata, &fs::metadata(&retried.original_path).unwrap()).unwrap());
        assert_eq!(fs::read(directory.join(MANIFEST_NAME)).unwrap(), journal);
        assert_eq!(restarted.begin(&id, metadata()).unwrap().state, RecordingState::Ready);
    }

    #[test]
    fn recovery_without_expected_end_count_stays_explicitly_interrupted() {
        let (_root, storage, id) = fixture();
        begin_with_audio(&storage, &id);
        let result = storage.finalize(&id, None).unwrap();
        assert!(result.interrupted);
        assert!(result.warnings.iter().any(|warning| warning == INTERRUPTED_WARNING));
        assert!(storage.finalize(&id, Some(1)).unwrap().interrupted);
    }

    #[test]
    fn missing_chunk_zero_is_not_shortened_success() {
        let (_root, storage, id) = fixture();
        storage.begin(&id, metadata()).unwrap();
        chunk(&storage, &id, 1, WEBM_HEADER);
        assert!(storage.finalize(&id, Some(1)).unwrap_err().contains("index 0"));
        assert!(!storage.directory(&id, false).unwrap().join("original.webm").exists());
        let listed = storage.list(false).unwrap();
        assert_eq!(listed.recordings.len(), 1);
        assert!(listed.recordings[0].warnings.iter().any(|warning| warning.contains("index 0")));
    }

    #[test]
    fn sequence_gaps_are_refused_and_visible_in_listing() {
        let (_root, storage, id) = fixture();
        storage.begin(&id, metadata()).unwrap();
        chunk(&storage, &id, 0, WEBM_HEADER);
        chunk(&storage, &id, 2, b"tail");
        assert!(storage.finalize(&id, None).unwrap_err().contains("gaps"));
        let listed = storage.list(false).unwrap();
        assert_eq!(listed.recordings[0].chunk_count, 2);
        assert!(listed.recordings[0].warnings.iter().any(|warning| warning.contains("gaps")));
    }

    #[test]
    fn expected_count_must_match_exactly_including_missing_final_chunks() {
        let (_root, storage, id) = fixture();
        begin_with_audio(&storage, &id);
        for expected in [0, 2] {
            let error = storage.finalize(&id, Some(expected)).unwrap_err();
            assert!(error.contains(&format!("Expected exactly {expected}")));
        }
        assert_eq!(manifest(&storage, &id).state, RecordingState::Capturing);
        assert!(!storage.directory(&id, false).unwrap().join("original.webm").exists());
        storage.finalize(&id, Some(1)).unwrap();
        assert!(storage.finalize(&id, Some(2)).is_err());
    }

    #[test]
    fn conflicting_original_is_never_replaced_even_at_the_same_length() {
        let (_root, storage, id) = fixture();
        let bytes = begin_with_audio(&storage, &id);
        let original = storage.directory(&id, false).unwrap().join("original.webm");
        let different = vec![b'x'; bytes.len()];
        fs::write(&original, &different).unwrap();
        assert!(storage.finalize(&id, Some(1)).unwrap_err().contains("different bytes"));
        assert_eq!(fs::read(&original).unwrap(), different);
        assert_eq!(manifest(&storage, &id).state, RecordingState::Capturing);
    }

    #[test]
    fn conflicting_original_extension_and_declared_mime_are_refused() {
        let (_root, storage, id) = fixture();
        begin_with_audio(&storage, &id);
        let other = storage.directory(&id, false).unwrap().join("original.m4a");
        fs::write(&other, MP4_HEADER).unwrap();
        assert!(storage.finalize(&id, Some(1)).unwrap_err().contains("conflicting original container"));
        assert_eq!(fs::read(&other).unwrap(), MP4_HEADER);
        let other_id = Uuid::new_v4().to_string();
        let mut mp4 = metadata();
        mp4.mime_type = "audio/mp4".into();
        storage.begin(&other_id, mp4).unwrap();
        chunk(&storage, &other_id, 0, WEBM_HEADER);
        assert!(storage.finalize(&other_id, Some(1)).unwrap_err().contains("conflicting with manifest MIME"));
        assert!(!storage.directory(&other_id, false).unwrap().join("original.m4a").exists());
    }

    #[test]
    fn failed_journal_update_after_original_publication_recovers_on_restart() {
        let (root, storage, id) = fixture();
        let expected = begin_with_audio(&storage, &id);
        FAIL_JOURNAL_UPDATE.with(|failure| failure.set(true));
        let error = storage.finalize(&id, Some(1)).unwrap_err();
        assert!(error.contains("Original audio was published"));
        assert!(error.contains("journal update failed"));
        let original = storage.directory(&id, false).unwrap().join("original.webm");
        let original_metadata = fs::metadata(&original).unwrap();
        assert_eq!(fs::read(&original).unwrap(), expected);
        assert_eq!(manifest(&storage, &id).state, RecordingState::Capturing);
        assert_eq!(storage.list(false).unwrap().recordings.len(), 1);
        let restarted = RecordingStorage::new(root.path()).unwrap();
        let result = restarted.finalize(&id, Some(1)).unwrap();
        assert_eq!(result.sha256, format!("{:x}", Sha256::digest(expected)));
        assert!(same_file(&original_metadata, &fs::metadata(original).unwrap()).unwrap());
        assert_eq!(manifest(&restarted, &id).state, RecordingState::Ready);
    }

    #[test]
    fn published_sessions_are_excluded_and_completion_is_retry_safe() {
        let (root, storage, id) = fixture();
        begin_with_audio(&storage, &id);
        let finalized = storage.finalize(&id, Some(1)).unwrap();
        assert_eq!(storage.list(false).unwrap().recordings.len(), 1);
        let source = source(&storage);
        let status = storage.complete(&id, source.to_str().unwrap()).unwrap();
        assert_eq!(status.state, RecordingState::Published);
        assert_eq!(status.source_path.as_deref(), Some("sources/fictional-source.md"));
        let journal = fs::read(storage.directory(&id, false).unwrap().join(MANIFEST_NAME)).unwrap();
        let restarted = RecordingStorage::new(root.path()).unwrap();
        restarted.complete(&id, "sources/fictional-source.md").unwrap();
        assert_eq!(fs::read(storage.directory(&id, false).unwrap().join(MANIFEST_NAME)).unwrap(), journal);
        assert!(restarted.list(false).unwrap().recordings.is_empty());
        assert!(Path::new(&finalized.original_path).exists());
        assert_eq!(scan_chunks(&storage.directory(&id, false).unwrap()).unwrap().chunk_count, 1);
        assert_eq!(restarted.begin(&id, metadata()).unwrap().state, RecordingState::Published);
        restarted.finalize(&id, None).unwrap();
        assert_eq!(manifest(&storage, &id).state, RecordingState::Published);
    }

    #[test]
    fn completion_requires_finalization_existing_source_and_original_and_refuses_new_source() {
        let (_root, storage, id) = fixture();
        begin_with_audio(&storage, &id);
        let source = source(&storage);
        assert!(storage.complete(&id, source.to_str().unwrap()).unwrap_err().contains("not been finalized"));
        let finalized = storage.finalize(&id, Some(1)).unwrap();
        assert!(storage.complete(&id, "sources/missing.md").unwrap_err().contains("missing"));
        let outside = tempfile::tempdir().unwrap();
        let outside_file = outside.path().join("source.md");
        fs::write(&outside_file, "outside fixture").unwrap();
        assert!(storage.complete(&id, outside_file.to_str().unwrap()).unwrap_err().contains("inside the vault"));
        assert!(storage.complete(&id, "../source.md").unwrap_err().contains("traversal"));
        storage.complete(&id, source.to_str().unwrap()).unwrap();
        let other_source = storage.root.join("other-source.md");
        fs::write(&other_source, "different source fixture").unwrap();
        assert!(storage.complete(&id, "other-source.md").unwrap_err().contains("different source path"));
        fs::remove_file(&finalized.original_path).unwrap();
        assert!(storage.complete(&id, source.to_str().unwrap()).unwrap_err().contains("missing"));
        assert!(outside_file.exists());
    }

    #[test]
    fn completion_checks_original_hash_before_marking_published() {
        let (_root, storage, id) = fixture();
        begin_with_audio(&storage, &id);
        let finalized = storage.finalize(&id, Some(1)).unwrap();
        let source = source(&storage);
        fs::write(&finalized.original_path, vec![b'x'; finalized.byte_length as usize]).unwrap();
        assert!(storage.complete(&id, source.to_str().unwrap()).unwrap_err().contains("SHA-256"));
        assert_eq!(manifest(&storage, &id).state, RecordingState::Ready);
    }

    #[test]
    fn legacy_webm_metadata_is_honest_and_adopted_only_by_finalization() {
        let (root, storage, id) = fixture();
        chunk(&storage, &id, 0, &WEBM_HEADER[..3]);
        chunk(&storage, &id, 1, &WEBM_HEADER[3..]);
        let listed = storage.list(false).unwrap();
        let candidate = &listed.recordings[0];
        assert_eq!(candidate.session_id, id);
        assert_eq!(candidate.metadata.mime_type, "audio/webm");
        assert!(DateTime::parse_from_rfc3339(&candidate.metadata.created).is_ok());
        assert!(candidate.warnings.iter().any(|warning| warning.contains("no recording.json")));
        assert!(candidate.warnings.iter().any(|warning| warning.contains("filesystem")));
        assert!(!storage.directory(&id, false).unwrap().join(MANIFEST_NAME).exists());
        assert!(storage.begin(&id, metadata()).unwrap_err().contains("already contains recording evidence"));
        let result = storage.finalize(&id, Some(2)).unwrap();
        assert!(result.interrupted);
        assert_eq!(fs::read(&result.original_path).unwrap(), WEBM_HEADER);
        assert!(manifest(&storage, &id).metadata_inferred);
        let restarted = RecordingStorage::new(root.path()).unwrap();
        let retried = restarted.finalize(&id, None).unwrap();
        assert_eq!(retried.metadata, result.metadata);
        assert_eq!(retried.sha256, result.sha256);
        assert_eq!(restarted.begin(&id, result.metadata).unwrap().state, RecordingState::Ready);
    }

    #[test]
    fn legacy_mp4_is_inferred_from_ftyp_and_published_as_m4a() {
        let (_root, storage, id) = fixture();
        chunk(&storage, &id, 0, MP4_HEADER);
        let candidate = storage.list(false).unwrap().recordings.remove(0);
        assert_eq!(candidate.metadata.mime_type, "audio/mp4");
        let result = storage.finalize(&id, None).unwrap();
        assert!(result.original_path.ends_with("/original.m4a"));
        assert_eq!(fs::read(result.original_path).unwrap(), MP4_HEADER);
        assert!(result.interrupted);
    }

    #[test]
    fn legacy_unknown_or_missing_initial_container_is_an_explicit_error_not_an_empty_list() {
        let (_root, storage, id) = fixture();
        chunk(&storage, &id, 0, b"not a recognizable media container");
        let error = storage.list(false).unwrap_err();
        assert!(error.contains(&id));
        assert!(error.contains("cannot reliably infer"));
        assert!(storage.finalize(&id, None).is_err());
        assert!(!storage.directory(&id, false).unwrap().join(MANIFEST_NAME).exists());
        let (_other_root, other, other_id) = fixture();
        chunk(&other, &other_id, 1, WEBM_HEADER);
        assert!(other.list(false).unwrap_err().contains("index 0"));
    }

    #[test]
    fn malformed_and_oversized_journals_are_explicit_errors_and_preserved() {
        let (_root, storage, id) = fixture();
        begin_with_audio(&storage, &id);
        let journal = storage.directory(&id, false).unwrap().join(MANIFEST_NAME);
        let malformed = b"{invalid journal";
        fs::write(&journal, malformed).unwrap();
        assert!(storage.list(false).unwrap_err().contains("Invalid recording journal"));
        assert!(storage.finalize(&id, Some(1)).is_err());
        assert!(storage.begin(&id, metadata()).is_err());
        assert_eq!(fs::read(&journal).unwrap(), malformed);
        fs::write(&journal, vec![b' '; MAX_MANIFEST_BYTES + 1]).unwrap();
        assert!(storage.list(false).unwrap_err().contains("exceeds 32 KB"));
    }

    #[test]
    fn journal_identity_state_and_source_traversal_are_rejected() {
        let (_root, storage, id) = fixture();
        begin_with_audio(&storage, &id);
        let valid = manifest(&storage, &id);
        let path = storage.directory(&id, false).unwrap().join(MANIFEST_NAME);
        let mut invalid = valid.clone();
        invalid.session_id = Uuid::new_v4().to_string();
        fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
        assert!(storage.list(false).unwrap_err().contains("identity"));
        invalid = valid;
        invalid.state = RecordingState::Published;
        invalid.source_path = Some("../outside.md".into());
        fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
        assert!(storage.list(false).unwrap_err().contains("lifecycle"));
    }

    #[test]
    fn unreadable_shapes_and_invalid_storage_entries_do_not_become_empty_success() {
        let (_root, storage, _id) = fixture();
        fs::write(storage.root.join(STORAGE_NAME), "not a directory").unwrap();
        assert!(storage.list(false).unwrap_err().contains("not a directory"));
        let (_other_root, other, _other_id) = fixture();
        fs::create_dir(other.root.join(STORAGE_NAME)).unwrap();
        fs::create_dir(other.root.join(STORAGE_NAME).join("invalid-session")).unwrap();
        assert!(other.list(false).unwrap_err().contains("Invalid recording storage entry"));
        let (_third_root, third, third_id) = fixture();
        third.directory(&third_id, true).unwrap();
        assert!(third.list(false).unwrap_err().contains("no durable audio"));
    }

    #[test]
    fn empty_capturing_sessions_are_not_recoverable_and_hud_blocks_all_candidates() {
        let (_root, storage, id) = fixture();
        assert!(storage.list(false).unwrap().recordings.is_empty());
        storage.begin(&id, metadata()).unwrap();
        assert!(storage.list(false).unwrap().recordings.is_empty());
        chunk(&storage, &id, 0, WEBM_HEADER);
        let active = storage.list(true).unwrap();
        assert!(active.active_recording);
        assert!(active.recordings.is_empty());
        assert_eq!(storage.list(false).unwrap().recordings.len(), 1);
    }

    #[test]
    fn temporary_files_are_kept_and_warned_about_but_not_assembled() {
        let (_root, storage, id) = fixture();
        let expected = begin_with_audio(&storage, &id);
        let temporary = storage.directory(&id, false).unwrap().join("abandoned.tmp");
        fs::write(&temporary, "unpublished fictional audio").unwrap();
        let result = storage.finalize(&id, Some(1)).unwrap();
        assert_eq!(fs::read(result.original_path).unwrap(), expected);
        assert_eq!(result.chunk_count, 1);
        assert!(result.warnings.iter().any(|warning| warning.contains("1 unpublished temporary")));
        assert!(temporary.exists());
    }

    #[test]
    fn invalid_chunk_names_zero_length_and_oversized_chunks_are_refused() {
        let (_root, storage, id) = fixture();
        storage.begin(&id, metadata()).unwrap();
        let directory = storage.directory(&id, false).unwrap();
        let invalid = directory.join("0.audio");
        fs::write(&invalid, WEBM_HEADER).unwrap();
        assert!(storage.list(false).unwrap_err().contains("filename"));
        fs::remove_file(invalid).unwrap();
        let path = chunk(&storage, &id, 0, b"");
        assert!(storage.finalize(&id, None).unwrap_err().contains("1-8 MB"));
        File::options().write(true).open(&path).unwrap().set_len(MAX_CHUNK_BYTES + 1).unwrap();
        assert!(storage.list(false).unwrap_err().contains("1-8 MB"));
    }

    #[test]
    fn container_inference_requires_specific_doctype_or_supported_brands() {
        assert_eq!(detect_container(WEBM_HEADER).unwrap(), Container::Webm);
        assert_eq!(detect_container(MP4_HEADER).unwrap(), Container::Mp4);
        assert!(detect_container(b"\x1a\x45\xdf\xa3").is_err());
        assert!(detect_container(b"\x1a\x45\xdf\xa3\x8b\x42\x82\x88matroska").is_err());
        assert!(detect_container(b"\x1a\x45\xdf\xa3\x80").is_err());
        assert!(detect_container(b"\x00\x00\x00\x18ftypqt  \x00\x00\x00\x00qt  qt  ").is_err());
        assert!(detect_container(&MP4_HEADER[..16]).is_err());
    }

    #[test]
    fn listing_orders_by_actual_created_time_not_timezone_string_order() {
        let (_root, storage, older) = fixture();
        let newer = Uuid::new_v4().to_string();
        let mut old_metadata = metadata();
        old_metadata.created = "2026-11-02T01:00:00+08:00".into();
        storage.begin(&older, old_metadata).unwrap();
        chunk(&storage, &older, 0, WEBM_HEADER);
        let mut new_metadata = metadata();
        new_metadata.created = "2026-11-01T18:00:00Z".into();
        storage.begin(&newer, new_metadata).unwrap();
        chunk(&storage, &newer, 0, WEBM_HEADER);
        let listed = storage.list(false).unwrap();
        assert_eq!(listed.recordings[0].session_id, newer);
        assert_eq!(listed.recordings[1].session_id, older);
    }

    #[test]
    fn changed_checkpoints_cannot_replace_finalized_original() {
        let (_root, storage, id) = fixture();
        let expected = begin_with_audio(&storage, &id);
        let result = storage.finalize(&id, Some(1)).unwrap();
        chunk(&storage, &id, 1, b"late checkpoint");
        assert!(storage.finalize(&id, None).unwrap_err().contains("conflict"));
        assert_eq!(fs::read(result.original_path).unwrap(), expected);
        assert!(storage.list(false).unwrap().recordings[0].warnings.iter().any(|warning| warning.contains("counts differ")));
    }

    #[test]
    fn missing_finalized_original_can_be_exactly_reassembled_from_retained_chunks() {
        let (_root, storage, id) = fixture();
        let expected = begin_with_audio(&storage, &id);
        let result = storage.finalize(&id, Some(1)).unwrap();
        fs::remove_file(&result.original_path).unwrap();
        assert!(storage.list(false).unwrap().recordings[0].warnings.iter().any(|warning| warning.contains("original is missing")));
        let recovered = storage.finalize(&id, None).unwrap();
        assert_eq!(fs::read(recovered.original_path).unwrap(), expected);
        assert_eq!(result.sha256, recovered.sha256);
    }

    /// The FFmpeg the app would use; the playback tests that need real audio skip without it.
    fn installed_ffmpeg() -> Option<PathBuf> {
        Some(ffmpeg_path()).filter(|path| path.is_file())
    }

    /// Two seconds of Opus as a browser recorder writes it, streamed: no duration and no cue index.
    fn streamed_webm(ffmpeg: &Path) -> Vec<u8> {
        let output = Command::new(ffmpeg)
            .args(["-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2:sample_rate=48000",
                "-c:a", "libopus", "-b:a", "32k", "-f", "webm", "pipe:1"])
            .output()
            .unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        output.stdout
    }

    /// One EBML integer at `at`: its value, its length in bytes, and whether it is an unknown size.
    fn ebml_at(bytes: &[u8], at: usize, id: bool) -> (u64, usize, bool) {
        let length = bytes[at].leading_zeros() as usize + 1;
        let mut value = if id { u64::from(bytes[at]) } else { u64::from(bytes[at]) & (0xff >> length) };
        for byte in &bytes[at + 1..at + length] {
            value = (value << 8) | u64::from(*byte);
        }
        (value, length, !id && value == (1u64 << (7 * length)) - 1)
    }

    /// The duration a WebM states in its Info element, in milliseconds, if it states one.
    fn stated_duration(bytes: &[u8]) -> Option<f64> {
        let (_, id, _) = ebml_at(bytes, 0, true);
        let (size, length, _) = ebml_at(bytes, id, false);
        let segment = id + length + size as usize;
        let (_, id, _) = ebml_at(bytes, segment, true);
        let (_, length, _) = ebml_at(bytes, segment + id, false);
        let mut at = segment + id + length;
        while at < bytes.len() {
            let (element, id, _) = ebml_at(bytes, at, true);
            let (size, length, unknown) = ebml_at(bytes, at + id, false);
            let body = at + id + length;
            if element == 0x1549_a966 {
                let mut child = body;
                while child < body + size as usize {
                    let (element, id, _) = ebml_at(bytes, child, true);
                    let (size, length, _) = ebml_at(bytes, child + id, false);
                    let value = &bytes[child + id + length..child + id + length + size as usize];
                    if element == 0x4489 {
                        return match value.len() {
                            4 => Some(f64::from(f32::from_be_bytes(value.try_into().ok()?))),
                            8 => Some(f64::from_be_bytes(value.try_into().ok()?)),
                            _ => None,
                        };
                    }
                    child += id + length + size as usize;
                }
                return None;
            }
            if unknown {
                return None;
            }
            at = body + size as usize;
        }
        None
    }

    #[test]
    fn a_browser_recording_plays_from_a_copy_that_states_its_length() {
        // Observed natively (D13): a recovered recording showed 0:01 in the player until it had a transcript.
        let Some(ffmpeg) = installed_ffmpeg() else {
            eprintln!("FFmpeg is not installed; the playable copy cannot be checked");
            return;
        };
        let (_root, storage, id) = fixture();
        storage.begin(&id, metadata()).unwrap();
        let streamed = streamed_webm(&ffmpeg);
        assert_eq!(stated_duration(&streamed), None);
        chunk(&storage, &id, 0, &streamed);
        let original = storage.finalize(&id, None).unwrap();
        let played = storage.playback(&original.original_path, &ffmpeg).unwrap();
        assert_eq!(played, storage.directory(&id, false).unwrap().join(PLAYBACK_NAME));
        let duration = stated_duration(&fs::read(&played).unwrap()).unwrap();
        assert!((1900.0..=2100.0).contains(&duration), "stated duration {duration} ms");
        // The original stays byte for byte; the copy is made once and is never taken for audio evidence.
        assert_eq!(fs::read(&original.original_path).unwrap(), streamed);
        let copied = fs::metadata(&played).unwrap();
        assert_eq!(storage.playback(&original.original_path, &ffmpeg).unwrap(), played);
        assert!(same_file(&copied, &fs::metadata(&played).unwrap()).unwrap());
        assert_eq!(storage.finalize(&id, None).unwrap().sha256, original.sha256);
        assert_eq!(storage.list(false).unwrap().recordings[0].chunk_count, 1);
        storage.complete(&id, source(&storage).to_str().unwrap()).unwrap();
    }

    #[test]
    fn a_recording_without_a_playable_copy_plays_as_it_is() {
        let (_root, storage, id) = fixture();
        begin_with_audio(&storage, &id);
        let original = storage.finalize(&id, Some(1)).unwrap();
        let directory = storage.directory(&id, false).unwrap();
        // Without FFmpeg, or with audio it cannot read, the original plays, and nothing is left behind.
        let missing = storage.root.join("no-ffmpeg");
        assert_eq!(storage.playback(&original.original_path, &missing).unwrap(), PathBuf::from(&original.original_path));
        if let Some(ffmpeg) = installed_ffmpeg() {
            assert_eq!(storage.playback(&original.original_path, &ffmpeg).unwrap(), PathBuf::from(&original.original_path));
        }
        assert!(!directory.join(PLAYBACK_NAME).exists());
        assert_eq!(scan_chunks(&directory).unwrap().temporary_files, 0);
        // Recordings that state their length, wherever they are in the vault, play as they are; nothing else is served.
        fs::write(storage.root.join("imported.wav"), b"RIFF fictional").unwrap();
        assert_eq!(storage.playback("imported.wav", &missing).unwrap(), storage.root.join("imported.wav"));
        fs::write(storage.root.join("original.webm"), WEBM_HEADER).unwrap();
        assert_eq!(storage.playback("original.webm", &missing).unwrap(), storage.root.join("original.webm"));
        fs::write(storage.root.join("notes.md"), "# Fictional notes\n").unwrap();
        assert!(storage.playback("notes.md", &missing).is_err());
        assert!(storage.playback(&directory.join(MANIFEST_NAME).to_string_lossy(), &missing).is_err());
        assert!(storage.playback("../outside.wav", &missing).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_playable_copy_is_never_served() {
        use std::os::unix::fs::symlink;
        let (_root, storage, id) = fixture();
        begin_with_audio(&storage, &id);
        let original = storage.finalize(&id, Some(1)).unwrap();
        let outside = tempfile::tempdir().unwrap();
        let target = outside.path().join("elsewhere.webm");
        fs::write(&target, WEBM_HEADER).unwrap();
        symlink(&target, storage.directory(&id, false).unwrap().join(PLAYBACK_NAME)).unwrap();
        assert_eq!(storage.playback(&original.original_path, &storage.root.join("no-ffmpeg")).unwrap(), PathBuf::from(&original.original_path));
        assert_eq!(fs::read(target).unwrap(), WEBM_HEADER);
    }

    #[tokio::test]
    async fn command_boundary_rejects_empty_missing_and_non_directory_vaults() {
        let id = Uuid::new_v4().to_string();
        assert!(begin_meeting_recording("".into(), id.clone(), metadata()).await.is_err());
        let root = tempfile::tempdir().unwrap();
        assert!(begin_meeting_recording(root.path().join("missing").to_str().unwrap().into(), id.clone(), metadata()).await.is_err());
        let file = root.path().join("not-a-vault");
        fs::write(&file, "fixture").unwrap();
        assert!(begin_meeting_recording(file.to_str().unwrap().into(), id, metadata()).await.is_err());
    }

    #[cfg(unix)]
    #[test]
    fn storage_and_session_symlinks_including_dangling_links_are_refused() {
        use std::os::unix::fs::symlink;
        let (_root, storage, id) = fixture();
        let outside = tempfile::tempdir().unwrap();
        symlink(outside.path(), storage.root.join(STORAGE_NAME)).unwrap();
        assert!(storage.begin(&id, metadata()).unwrap_err().contains("symlink"));
        assert!(storage.list(false).unwrap_err().contains("symlink"));
        assert!(storage.finalize(&id, None).unwrap_err().contains("symlink"));
        assert!(outside.path().read_dir().unwrap().next().is_none());
        let (_other_root, other, other_id) = fixture();
        fs::create_dir(other.root.join(STORAGE_NAME)).unwrap();
        symlink(outside.path().join("missing"), other.root.join(STORAGE_NAME).join(&other_id)).unwrap();
        assert!(other.begin(&other_id, metadata()).unwrap_err().contains("symlink"));
        assert!(other.list(false).unwrap_err().contains("symlink"));
    }

    #[cfg(unix)]
    #[test]
    fn chunk_and_manifest_symlinks_are_refused_without_touching_targets() {
        use std::os::unix::fs::symlink;
        let (_root, storage, id) = fixture();
        begin_with_audio(&storage, &id);
        let outside = tempfile::tempdir().unwrap();
        let target = outside.path().join("audio");
        fs::write(&target, WEBM_HEADER).unwrap();
        let directory = storage.directory(&id, false).unwrap();
        let audio = directory.join("0000000000.audio");
        fs::remove_file(&audio).unwrap();
        symlink(&target, &audio).unwrap();
        assert!(storage.finalize(&id, Some(1)).unwrap_err().contains("symlink"));
        assert!(storage.list(false).unwrap_err().contains("symlink"));
        fs::remove_file(audio).unwrap();
        chunk(&storage, &id, 0, WEBM_HEADER);
        let journal = directory.join(MANIFEST_NAME);
        fs::remove_file(&journal).unwrap();
        symlink(&target, &journal).unwrap();
        assert!(storage.begin(&id, metadata()).unwrap_err().contains("symlink"));
        assert!(storage.list(false).unwrap_err().contains("symlink"));
        assert!(storage.finalize(&id, None).unwrap_err().contains("symlink"));
        assert_eq!(fs::read(target).unwrap(), WEBM_HEADER);
    }

    #[cfg(unix)]
    #[test]
    fn original_and_source_symlinks_are_refused() {
        use std::os::unix::fs::symlink;
        let (_root, storage, id) = fixture();
        begin_with_audio(&storage, &id);
        let outside = tempfile::tempdir().unwrap();
        let target = outside.path().join("original");
        fs::write(&target, WEBM_HEADER).unwrap();
        let original = storage.directory(&id, false).unwrap().join("original.webm");
        symlink(&target, &original).unwrap();
        assert!(storage.finalize(&id, Some(1)).unwrap_err().contains("symlink"));
        fs::remove_file(&original).unwrap();
        storage.finalize(&id, Some(1)).unwrap();
        let linked_source = storage.root.join("linked-source.md");
        symlink(&target, &linked_source).unwrap();
        assert!(storage.complete(&id, "linked-source.md").unwrap_err().contains("symlink"));
        let linked_directory = storage.root.join("linked-sources");
        symlink(outside.path(), &linked_directory).unwrap();
        assert!(storage.complete(&id, "linked-sources/original").unwrap_err().contains("symlink"));
        assert_eq!(manifest(&storage, &id).state, RecordingState::Ready);
        assert_eq!(fs::read(target).unwrap(), WEBM_HEADER);
    }
}
