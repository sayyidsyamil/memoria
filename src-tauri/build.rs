use std::path::Path;
use std::process::Command;

fn main() {
    // Ensure resource directory exists for the Tauri build.
    // Gitignored and populated by bundle-mcp-server.mjs.
    // Without a placeholder, `tauri build` / `cargo test` fails if the script hasn't run.
    let path = Path::new("resources/mcp-server");
    if !path.exists() {
        std::fs::create_dir_all(path).ok();
        std::fs::write(path.join(".placeholder"), "").ok();
    }
    build_call_audio_helper();
    tauri_build::build()
}

/// Compiles the call audio helper (Swift, macOS targets only) to `binaries/memoria-call-audio-<target triple>`, the
/// name `bundle.externalBin` in tauri.macos.conf.json expects. tauri-build then copies it next to the app's executable,
/// and the bundler puts it in Memoria.app/Contents/MacOS, signed with the app.
fn build_call_audio_helper() {
    let target = std::env::var("TARGET").unwrap_or_default();
    if !target.ends_with("-apple-darwin") {
        return;
    }
    let source = Path::new("native/call-audio/main.swift");
    let output = Path::new("binaries").join(format!("memoria-call-audio-{target}"));
    println!("cargo:rerun-if-changed={}", source.display());
    // tauri-build watches the output too; leaving a current binary untouched keeps it from rerunning this script.
    let modified = |path: &Path| {
        path.metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
    };
    if matches!((modified(&output), modified(source)), (Some(built), Some(edited)) if built >= edited)
    {
        return;
    }
    let (arch, oldest) = if target.starts_with("x86_64") {
        ("x86_64", "10.13")
    } else {
        ("arm64", "11.0")
    };
    let requested = std::env::var("MACOSX_DEPLOYMENT_TARGET").ok();
    let minimum = newer_version(requested.as_deref(), oldest);
    std::fs::create_dir_all("binaries").expect("could not create src-tauri/binaries");
    let status = Command::new("xcrun")
        .args(["--sdk", "macosx", "swiftc", "-O", "-swift-version", "5", "-module-name", "MemoriaCallAudio"])
        .args(["-target", &format!("{arch}-apple-macos{minimum}")])
        .arg(source)
        .arg("-o")
        .arg(&output)
        .status()
        .unwrap_or_else(|error| panic!("building memoria-call-audio needs swiftc from the Xcode Command Line Tools (xcode-select --install): {error}"));
    assert!(
        status.success(),
        "swiftc could not build {}",
        source.display()
    );
    // Dated like its source, so that tauri-build's watch on the binary does not rerun this script after this build.
    if let (Ok(file), Some(edited)) = (
        std::fs::File::options().write(true).open(&output),
        modified(source),
    ) {
        let _ = file.set_modified(edited);
    }
}

/// The later of a requested macOS version and the oldest the helper can target on this architecture.
fn newer_version<'a>(requested: Option<&'a str>, oldest: &'a str) -> &'a str {
    let parse = |version: &str| {
        version
            .split('.')
            .map(|part| part.parse::<u32>().unwrap_or(0))
            .collect::<Vec<_>>()
    };
    match requested {
        Some(version) if parse(version) > parse(oldest) => version,
        _ => oldest,
    }
}
