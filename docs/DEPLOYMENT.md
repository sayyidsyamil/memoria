# Deployment

How to build a Memoria release and install it on another Mac. Apple-silicon macOS only.

## Prerequisites

On the **build machine**: Xcode command line tools (`xcode-select --install`), Rust (`rustup`), Node.js and pnpm, Python 3.11, git, and the `engine` folder next to the app folder (`../engine`), because the build copies `memoria_engine/` into the app.

On the **target machine** (the one that will use the app):

| Need | How |
|---|---|
| Apple-silicon Mac | M1 or later |
| Python 3.11 | `brew install python@3.11` (default path `/opt/homebrew/bin/python3.11`) |
| Python packages | `/opt/homebrew/bin/python3.11 -m pip install -r requirements.txt` (the file is `src-tauri/resources/python/requirements.txt` in the source, and `Memoria.app/Contents/Resources/python/requirements.txt` inside the app) |
| git | `xcode-select --install` |
| Disk | at least 10 GB free; models need about 5 GB |
| Internet | once, to download the four models on first use |

## Build a release

```bash
pnpm install
pnpm tauri build
```

`pnpm tauri build` first runs `pnpm build`, `pnpm bundle-mcp` and `pnpm agent-docs` (see `beforeBuildCommand` in `src-tauri/tauri.conf.json`). It is heavy (several minutes, high CPU and memory); close other programs.

Results:

- `src-tauri/target/release/bundle/macos/Memoria.app`
- `src-tauri/target/release/bundle/dmg/Memoria_0.1.0_aarch64.dmg`

The app is signed ad hoc (`bundle.macOS.signingIdentity` is `-`), not with an Apple Developer ID, and it is not notarised. On a Mac other than the build machine, macOS blocks the first launch. Open it with **right-click, Open, Open**, or run `xattr -dr com.apple.quarantine /Applications/Memoria.app` once.

The app bundles these folders under `Contents/Resources`: `demo-vault` (offline starter vault), `python` (transcription and import scripts, `requirements.txt`), `engine/memoria_engine` (decision engine), `mcp-server`, `agent-docs`. Python itself and its packages are not bundled.

## Install on a clean macOS account

1. Open Terminal and install Python 3.11 and git if missing: `brew install python@3.11` and `xcode-select --install`.
2. Copy `Memoria.dmg` to the Mac, open it, and drag **Memoria** to **Applications**.
3. Install the Python packages. Either use the file inside the app:
   `/opt/homebrew/bin/python3.11 -m pip install -r /Applications/Memoria.app/Contents/Resources/python/requirements.txt`
4. Check the machine. Copy `scripts/memoria-doctor.sh` from the source to the Mac and run `bash memoria-doctor.sh`. If the engine is not found in the source layout, set `MEMORIA_ENGINE_DIR=/Applications/Memoria.app/Contents/Resources/engine`. It prints PASS/FAIL per item and ends with `READY` or `NOT READY` plus the command to fix each failure. It changes nothing and downloads nothing.
5. Open the app with right-click, Open (see above). When asked, choose **Getting Started**.
6. Follow `welcome.md` in the new vault: Decisions & commitments, Setup, Load sample setup, Meetings, add the three meetings, Ask. The first meeting takes longer because the language model is downloaded (about 5 GB in total for all models) and loaded.

If your Python is somewhere else, set `MEMORIA_PYTHON`. Apps started from Finder do not read shell variables; set one for every app with `launchctl setenv MEMORIA_PYTHON /path/to/python3.11` and restart Memoria, or start the app from Terminal (`MEMORIA_PYTHON=... open -a Memoria`).

## First run

**Getting Started** does not use the internet. The app copies its bundled `demo-vault` folder into a temporary git repository, clones that into `~/Documents/Getting Started`, removes the remote and commits the config files. The vault holds `welcome.md`, the type files, and three fictional meeting notes (`Procurement pilot kick-off`, `progress check`, `pre-launch review`). To clone a repository instead, set `MEMORIA_GETTING_STARTED_REPO_URL`.

The three notes are copies of `engine/data/demo/meeting_1.md` to `meeting_3.md`. After changing those files, run `scripts/sync-demo-notes.sh`; a Rust test (`demo_starter::tests::bundled_demo_notes_match_the_engine_copies`) fails when the copies differ.

## Where data lives

| Data | Location |
|---|---|
| Notes and transcripts (the vault) | the folder you chose, default `~/Documents/Getting Started` |
| Decision ledger | `~/Library/Application Support/com.memoria.app/ledger/<8 hex characters of the vault path hash>/` (`ledger.sqlite`, `ledger.jsonl`, `registry.json`) |
| App settings | `~/Library/Application Support/com.memoria.app/settings.json` |
| Voice profiles (only if switched on) | `~/.memoria/` (`voices.json`, `sessions/`) |
| Downloaded models | `~/.cache/huggingface/hub/` (or `$HF_HUB_CACHE`) |

## Reset and uninstall

- Forget the ledger of one vault: quit the app and delete its folder under `~/Library/Application Support/com.memoria.app/ledger/`. Notes are not affected; add the meetings again.
- Delete voice profiles: Settings, Telemetry section, **Delete all saved voice profiles** (or delete `~/.memoria/`).
- Start from scratch: delete `~/Documents/Getting Started` and `~/Library/Application Support/com.memoria.app/`, then reopen the app.
- Uninstall: drag `/Applications/Memoria.app` to the Bin and delete the folders above. To free disk space, delete the Hugging Face models you no longer need from `~/.cache/huggingface/hub/` (`models--mlx-community--Qwen3.5-4B-MLX-4bit`, `...parakeet-tdt-0.6b-v3`, `...diar_streaming_sortformer_4spk-v2.1-fp16`, `...wespeaker-voxceleb-resnet34-LM`).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Memoria can't be opened because Apple cannot check it" | Not notarised | Right-click, Open, Open; or `xattr -dr com.apple.quarantine /Applications/Memoria.app` |
| "Python 3.11 was not found at ..." | Python missing or elsewhere | `brew install python@3.11`, or set `MEMORIA_PYTHON` |
| "The decision engine was not found at ..." | Engine not in the app or not next to it | Set `MEMORIA_ENGINE_DIR` to the folder that contains `memoria_engine/` |
| Decisions panel stays on "Starting the decision engine" | Model loading on first use, or Python packages missing | Wait a few minutes; run `scripts/memoria-doctor.sh`; try `MEMORIA_LEDGER_EXTRACTOR=keyword` to test without the model |
| Transcription fails to start | Packages missing or microphone not allowed | Install `requirements.txt`; System Settings, Privacy & Security, Microphone, allow Memoria |
| First meeting takes very long | Models downloading | One-time download of about 5 GB; needs internet |
| Getting Started fails with a git error | git missing | `xcode-select --install` |
| Setting a variable has no effect | App launched from Finder | `launchctl setenv`, then restart the app, or launch from Terminal |
| A suggestion says it is out of date | Something newer was recorded after it was made | It is refreshed automatically; press Dismiss or review the new value |
