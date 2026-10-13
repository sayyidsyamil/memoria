//! Pure protocol logic for the decision-ledger service (JSON lines over stdin/stdout).
//!
//! Nothing here spawns processes, so every function can be tested with in-memory buffers.

use serde_json::{json, Value};
use std::fmt;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

const SLOW_METHODS: &[&str] = &["meetings.ingest", "ask"];
const SLOW_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const FAST_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, PartialEq)]
pub enum LedgerError {
    PythonMissing(PathBuf),
    EngineMissing(PathBuf),
    Spawn(String),
    /// The service exited; carries the last lines it wrote to stderr.
    Died(String),
    Timeout(Duration),
    BadJson(String),
    Engine { kind: String, message: String },
    Invalid(String),
}

impl fmt::Display for LedgerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PythonMissing(p) => write!(
                f,
                "Python 3.11 was not found at {}. Install it (brew install python@3.11) or set MEMORIA_PYTHON to the right path.",
                p.display()
            ),
            Self::EngineMissing(p) => write!(
                f,
                "The decision engine was not found at {}. Set MEMORIA_ENGINE_DIR to the folder that contains memoria_engine.",
                p.display()
            ),
            Self::Spawn(e) => write!(f, "The decision engine could not be started: {e}"),
            Self::Died(tail) if tail.is_empty() => {
                write!(f, "The decision engine stopped unexpectedly. Try again; it will be restarted.")
            }
            Self::Died(tail) => write!(
                f,
                "The decision engine stopped unexpectedly. Try again; it will be restarted. Details: {tail}"
            ),
            Self::Timeout(d) => write!(
                f,
                "The decision engine took longer than {} seconds and was stopped. Try again; it will be restarted.",
                d.as_secs()
            ),
            Self::BadJson(line) => write!(f, "The decision engine sent an answer Memoria could not read: {line}"),
            // The "[Kind]" prefix lets the frontend branch on the engine error type (e.g. StaleProposal).
            Self::Engine { kind, message } => write!(f, "[{kind}] {message}"),
            Self::Invalid(msg) => write!(f, "{msg}"),
        }
    }
}

pub fn timeout_for(method: &str) -> Duration {
    if SLOW_METHODS.contains(&method) {
        SLOW_TIMEOUT
    } else {
        FAST_TIMEOUT
    }
}

pub fn request_line(id: u64, method: &str, params: &Value) -> String {
    let params = if params.is_null() { json!({}) } else { params.clone() };
    format!("{}\n", json!({ "id": id, "method": method, "params": params }))
}

pub fn write_request<W: Write>(out: &mut W, id: u64, method: &str, params: &Value) -> io::Result<()> {
    out.write_all(request_line(id, method, params).as_bytes())?;
    out.flush()
}

/// Python reports `KeyError('x')` as `'x'`; drop the quotes so the message reads naturally.
fn clean_message(kind: &str, message: &str) -> String {
    let trimmed = message.trim();
    let quoted = trimmed.len() >= 2
        && ((trimmed.starts_with('\'') && trimmed.ends_with('\'')) || (trimmed.starts_with('"') && trimmed.ends_with('"')));
    if kind == "KeyError" && quoted {
        trimmed[1..trimmed.len() - 1].to_string()
    } else {
        trimmed.to_string()
    }
}

fn engine_error(frame: &Value) -> LedgerError {
    let error = &frame["error"];
    let kind = error["type"].as_str().unwrap_or("Error").to_string();
    let message = error["message"].as_str().unwrap_or("the decision engine reported an error");
    LedgerError::Engine { message: clean_message(&kind, message), kind }
}

fn next_frame<R: BufRead>(reader: &mut R) -> Result<Value, LedgerError> {
    let mut line = String::new();
    loop {
        line.clear();
        let read = reader.read_line(&mut line).map_err(|e| LedgerError::Died(e.to_string()))?;
        if read == 0 {
            return Err(LedgerError::Died(String::new()));
        }
        let text = line.trim();
        // Libraries sometimes print stray text to stdout; only brace-led lines are frames.
        if !text.starts_with('{') {
            continue;
        }
        return serde_json::from_str(text)
            .map_err(|_| LedgerError::BadJson(text.chars().take(120).collect()));
    }
}

/// Read frames until the one answering `id`; frames for other ids are skipped.
pub fn read_response<R: BufRead>(reader: &mut R, id: u64) -> Result<Value, LedgerError> {
    loop {
        let frame = next_frame(reader)?;
        if frame["id"].as_u64() != Some(id) {
            continue;
        }
        return if frame["ok"].as_bool() == Some(true) {
            Ok(frame["result"].clone())
        } else {
            Err(engine_error(&frame))
        };
    }
}

/// The service announces itself with `{"id":null,"ok":true,"result":{"ready":true,...}}`.
pub fn read_ready<R: BufRead>(reader: &mut R) -> Result<Value, LedgerError> {
    loop {
        let frame = next_frame(reader)?;
        if frame["ok"].as_bool() == Some(false) {
            return Err(engine_error(&frame));
        }
        if frame["result"]["ready"].as_bool() == Some(true) {
            return Ok(frame["result"].clone());
        }
    }
}

pub fn sha1_hex(data: &[u8]) -> String {
    let mut h: [u32; 5] = [0x6745_2301, 0xEFCD_AB89, 0x98BA_DCFE, 0x1032_5476, 0xC3D2_E1F0];
    let mut msg = data.to_vec();
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend(((data.len() as u64) * 8).to_be_bytes());
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 80];
        for (i, word) in chunk.chunks(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let [mut a, mut b, mut c, mut d, mut e] = h;
        for (i, wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | (!b & d), 0x5A82_7999),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDC),
                _ => (b ^ c ^ d, 0xCA62_C1D6u32),
            };
            let t = a.rotate_left(5).wrapping_add(f).wrapping_add(e).wrapping_add(k).wrapping_add(*wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = t;
        }
        for (slot, value) in h.iter_mut().zip([a, b, c, d, e]) {
            *slot = slot.wrapping_add(value);
        }
    }
    h.iter().map(|x| format!("{x:08x}")).collect()
}

/// `<app data>/ledger/<first 8 hex of sha1(vault path)>`: kept outside the vault's git-tracked notes.
pub fn ledger_home(app_data_dir: &Path, vault_path: &str) -> PathBuf {
    let key = vault_path.trim().trim_end_matches('/');
    app_data_dir.join("ledger").join(&sha1_hex(key.as_bytes())[..8])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn reader(text: &str) -> Cursor<Vec<u8>> {
        Cursor::new(text.as_bytes().to_vec())
    }

    #[test]
    fn request_line_is_one_json_line_with_id_method_and_params() {
        let line = request_line(7, "query", &json!({"type": "current"}));
        assert!(line.ends_with('\n') && line.matches('\n').count() == 1);
        let parsed: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(parsed, json!({"id": 7, "method": "query", "params": {"type": "current"}}));
    }

    #[test]
    fn null_params_become_an_empty_object() {
        let parsed: Value = serde_json::from_str(&request_line(1, "ping", &Value::Null)).unwrap();
        assert_eq!(parsed["params"], json!({}));
    }

    #[test]
    fn write_request_writes_to_any_writer() {
        let mut buf: Vec<u8> = Vec::new();
        write_request(&mut buf, 3, "brief", &json!({})).unwrap();
        assert_eq!(String::from_utf8(buf).unwrap(), "{\"id\":3,\"method\":\"brief\",\"params\":{}}\n");
    }

    #[test]
    fn read_response_returns_the_result_for_the_matching_id() {
        let mut r = reader("{\"id\":1,\"ok\":true,\"result\":\"old\"}\n{\"id\":2,\"ok\":true,\"result\":{\"a\":1}}\n");
        assert_eq!(read_response(&mut r, 2).unwrap(), json!({"a": 1}));
    }

    #[test]
    fn read_response_skips_blank_lines_and_stray_text() {
        let mut r = reader("\nloading weights...\n{\"id\":5,\"ok\":true,\"result\":[]}\n");
        assert_eq!(read_response(&mut r, 5).unwrap(), json!([]));
    }

    #[test]
    fn read_response_maps_engine_errors_to_readable_text() {
        let mut r = reader("{\"id\":4,\"ok\":false,\"error\":{\"type\":\"KeyError\",\"message\":\"'unknown slot ghost.x'\"}}\n");
        let err = read_response(&mut r, 4).unwrap_err();
        assert_eq!(err, LedgerError::Engine { kind: "KeyError".into(), message: "unknown slot ghost.x".into() });
        assert_eq!(err.to_string(), "[KeyError] unknown slot ghost.x");
    }

    #[test]
    fn read_response_keeps_the_engine_error_type_for_the_frontend() {
        let mut r = reader("{\"id\":6,\"ok\":false,\"error\":{\"type\":\"StaleProposal\",\"message\":\"proposal 3 was made against a belief that has since changed\"}}\n");
        let text = read_response(&mut r, 6).unwrap_err().to_string();
        assert_eq!(text, "[StaleProposal] proposal 3 was made against a belief that has since changed");
    }

    #[test]
    fn read_response_reports_eof_as_died() {
        let err = read_response(&mut reader("{\"id\":9,\"ok\":true,\"result\":1}\n"), 4).unwrap_err();
        assert!(matches!(err, LedgerError::Died(_)));
        assert!(err.to_string().contains("stopped unexpectedly"));
    }

    #[test]
    fn read_response_rejects_malformed_json() {
        let err = read_response(&mut reader("{not json\n"), 1).unwrap_err();
        assert!(matches!(err, LedgerError::BadJson(_)));
    }

    #[test]
    fn read_ready_accepts_the_announcement_and_surfaces_startup_errors() {
        let mut ok = reader("warming up\n{\"id\":null,\"ok\":true,\"result\":{\"ready\":true,\"version\":\"0.1\"}}\n");
        assert_eq!(read_ready(&mut ok).unwrap()["version"], "0.1");
        let mut bad = reader("{\"id\":null,\"ok\":false,\"error\":{\"type\":\"ValueError\",\"message\":\"bad registry\"}}\n");
        assert_eq!(read_ready(&mut bad).unwrap_err().to_string(), "[ValueError] bad registry");
        assert!(matches!(read_ready(&mut reader("")).unwrap_err(), LedgerError::Died(_)));
    }

    #[test]
    fn slow_methods_get_fifteen_minutes_and_others_sixty_seconds() {
        assert_eq!(timeout_for("meetings.ingest"), Duration::from_secs(900));
        assert_eq!(timeout_for("ask"), Duration::from_secs(900));
        assert_eq!(timeout_for("facts.current"), Duration::from_secs(60));
    }

    #[test]
    fn errors_name_the_path_that_was_tried() {
        let python = LedgerError::PythonMissing(PathBuf::from("/nope/python3.11")).to_string();
        assert!(python.contains("/nope/python3.11") && python.contains("MEMORIA_PYTHON"));
        let engine = LedgerError::EngineMissing(PathBuf::from("/nope/engine")).to_string();
        assert!(engine.contains("/nope/engine") && engine.contains("MEMORIA_ENGINE_DIR"));
        let died = LedgerError::Died("ModuleNotFoundError: mlx".into()).to_string();
        assert!(died.contains("ModuleNotFoundError: mlx"));
    }

    #[test]
    fn sha1_matches_known_vectors() {
        assert_eq!(sha1_hex(b""), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
        assert_eq!(sha1_hex(b"abc"), "a9993e364706816aba3e25717850c26c9cd0d89d");
        let long = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
        assert_eq!(sha1_hex(long.as_bytes()), "84983e441c3bd26ebaae4aa1f95129e5e54670f1");
    }

    #[test]
    fn ledger_home_is_stable_per_vault_and_ignores_a_trailing_slash() {
        let base = Path::new("/data/app");
        let a = ledger_home(base, "/Users/x/Vault");
        assert_eq!(a, ledger_home(base, "/Users/x/Vault/"));
        assert_ne!(a, ledger_home(base, "/Users/x/Other"));
        assert_eq!(a.parent().unwrap(), base.join("ledger"));
        let name = a.file_name().unwrap().to_str().unwrap();
        assert_eq!(name.len(), 8);
        assert!(name.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
