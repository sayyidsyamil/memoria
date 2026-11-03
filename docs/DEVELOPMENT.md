# Development setup

## Frontend

Requirements: Node.js 22+, pnpm 10, and Git.

```sh
git clone https://github.com/sayyidsyamil/memoria.git
cd memoria
pnpm install --frozen-lockfile
pnpm dev
```

Browser development uses a mock Tauri bridge. It does not run native microphone
capture, filesystem publication, or the resident inference workers.

```sh
pnpm build
pnpm test:memoria
pnpm exec vitest run  # full frontend suite
```

## Native desktop

Install Rust stable and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
The local meeting models run on Apple-silicon macOS only; the foundations inherited
from Tolaria support more platforms.

```sh
pnpm tauri dev
```

To produce a development application bundle:

```sh
pnpm tauri build --debug --bundles app
```

The resulting bundle is under `src-tauri/target/debug/bundle/`. A debug bundle is
not a signed, supported distribution. macOS may ask again for microphone permission
after the application is rebuilt and re-signed.

On macOS, every Cargo build (`cargo build`, `cargo test`, `pnpm tauri dev|build`) also
compiles the call audio helper, `src-tauri/native/call-audio/main.swift`, with `swiftc`
from the Xcode Command Line Tools (`xcode-select --install`), into the gitignored
`src-tauri/binaries/`; the build fails with that hint when `swiftc` is missing. Other
platforms skip it. macOS asks for System Audio Recording the first time call audio
starts, and attributes the request to the app that started the helper: Memoria for a
bundle, the terminal for `pnpm tauri dev`. `memoria-call-audio --test-tone --verbose`
runs the helper's conversion and framing on a synthetic tone, with no permission.

## Inference prerequisites

The app does not bundle Python or the models. `scripts/install-shared-runtime.sh`
builds the speech and embedding runtimes from the committed freezes
(`scripts/runtime/*-requirements.txt`, pinned versions) and copies the model revisions of
`scripts/runtime/models.json` from the developer's Hugging Face cache to `/Users/Shared/Memoria`;
see [the AC7 install steps](GETTING-STARTED.md#install-for-another-macos-account-ac7).
To use other environments, set these variables in the shell that starts Tauri:

| Variable | Purpose |
| --- | --- |
| `MEMORIA_SPEECH_PYTHON` | Python environment with MLX Audio STT, Resemblyzer, SoundFile, NumPy, and Hugging Face tooling |
| `MEMORIA_MEMORY_PYTHON` | Python environment with MLX LM and Hugging Face tooling |
| `MEMORIA_EMBED_PYTHON` | Python environment with MLX VLM embedding support, Transformers, NumPy, and Hugging Face tooling |
| `MEMORIA_FFMPEG` | Absolute path to the FFmpeg executable used by audio conversion and by the player's copy of browser recordings |

Use absolute paths to interpreter executables, for example:

```sh
export MEMORIA_SPEECH_PYTHON="$HOME/.venvs/memoria-speech/bin/python"
export MEMORIA_MEMORY_PYTHON="$HOME/.venvs/memoria-memory/bin/python"
export MEMORIA_EMBED_PYTHON="$HOME/.venvs/memoria-embed/bin/python"
export MEMORIA_FFMPEG="$(command -v ffmpeg)"
pnpm tauri dev
```

These commands select existing environments; they do not create them. The variables
win, then a complete shared install in `/Users/Shared/Memoria`, then the repository-local
`.speech-runtime/` and `.embed-runtime/` environments and Homebrew `python3.11`.
The models, with the revisions in `scripts/runtime/models.json`:

- Speech: `selcukkubur/parakeet-ultra-mlx` (revision `b554592c50b2a48471add2daa3d46fa9f00fef5e`) and
  `mlx-community/Nemotron-3-Diarization` (revision `59ed2dbfc1346dcea9d423c71306a3a2499c568f`). The earlier
  `OpenMOSS-Team/MOSS-Transcribe-Diarize` engine stays available with `MEMORIA_SPEECH_ENGINE=moss`.
- Generation: `mlx-community/Qwen3.5-4B-MLX-4bit` (revision `32f3e8ecf65426fc3306969496342d504bfa13f3`).
- Embedding: `mlx-community/embeddinggemma-2-5bit` (revision `261866f6805342b010554507220e02199a579c74`).

Native workers run offline and do not download missing weights. The model licences are
listed in [NOTICE.md](../NOTICE.md). The footer shows Speech, Knowledge and Search
readiness; Ready does not establish speech or answer accuracy.
See [Model lifecycle](MODEL-LIFECYCLE.md) for the workers, their memory and restarts.

## Python tests without models

```sh
cd src-tauri/resources/memory && python3.11 -m unittest discover
```

The app's Python suite (214 tests on 3 November 2026) fakes or injects every model
call and uses temporary vaults. It covers journal, meeting, ledger and live-check
behaviour, not native media devices or model accuracy. The ledger engine's own tests
are run from `research/ledger-engine` ([research/README.md](../research/README.md)).

## Workspace fixtures

Copy `memoria-demo/` to a temporary location before using it as a vault. Its people
and project scenario are fictional. Runtime journals, microphone recordings,
Python environments, and model weights are not versioned. The UAT starter vault is
built by `scripts/uat/build_demo_vault.py`.

## Automation and history

The active GitHub workflow is `memoria-checks.yml`: frontend build, the scoped
Memoria suite, and deterministic engine tests. It does not run the full frontend
suite or native checks. Upstream CI and release workflows are archived under
`reference/upstream-workflows/` because their services and signing identities are
not Memoria infrastructure.

The Git hooks use the same local policy: a staged whitespace check before commit,
then build, scoped frontend tests, and deterministic Python tests before push.
The original hooks are archived with the upstream workflow references. The full
frontend suite is run by hand; its latest result is in
[WORKSPACE-PRODUCT-VERIFICATION.md](WORKSPACE-PRODUCT-VERIFICATION.md).

`main` is the desktop workspace, `legacy` preserves the prior default Next.js app,
and the `fyp2` and `master` branches keep their historical contents.
