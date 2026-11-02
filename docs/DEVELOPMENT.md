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
pnpm exec vitest run  # broader suite; known failures remain
```

## Native desktop

Install Rust stable and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
The new local meeting-model runtime is currently evaluated on Apple Silicon macOS;
the inherited application foundations have a broader platform scope.

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

The Python runtime is **not yet packaged or reproducibly pinned**. Bring separate
compatible environments and configure these variables in the shell used to start
Tauri; do not rely on the developer-machine fallback paths:

| Variable | Purpose |
| --- | --- |
| `MEMORIA_SPEECH_PYTHON` | Python environment with MLX Audio STT, Resemblyzer, SoundFile, NumPy, and Hugging Face tooling |
| `MEMORIA_MEMORY_PYTHON` | Python environment with MLX LM and Hugging Face tooling |
| `MEMORIA_EMBED_PYTHON` | Python environment with MLX VLM embedding support, Transformers, NumPy, and Hugging Face tooling |
| `MEMORIA_FFMPEG` | Absolute path to the FFmpeg executable used by audio conversion |

Use absolute paths to interpreter executables, for example:

```sh
export MEMORIA_SPEECH_PYTHON="$HOME/.venvs/memoria-speech/bin/python"
export MEMORIA_MEMORY_PYTHON="$HOME/.venvs/memoria-memory/bin/python"
export MEMORIA_EMBED_PYTHON="$HOME/.venvs/memoria-embed/bin/python"
export MEMORIA_FFMPEG="$(command -v ffmpeg)"
pnpm tauri dev
```

These commands select existing environments; they do not create them. Without the
variables, development builds fall back to the unversioned repository-local
`.speech-runtime/` and `.embed-runtime/` environments and Homebrew `python3.11`.
The model adapters expect the following models to have been cached separately:

- Speech: `selcukkubur/parakeet-ultra-mlx` (revision `b554592c50b2a48471add2daa3d46fa9f00fef5e`) and
  `mlx-community/Nemotron-3-Diarization` (revision `59ed2dbfc1346dcea9d423c71306a3a2499c568f`). The earlier
  `OpenMOSS-Team/MOSS-Transcribe-Diarize` engine stays available with `MEMORIA_SPEECH_ENGINE=moss`.
- Generation: `mlx-community/Qwen3.5-4B-MLX-4bit`.
- Embedding: `mlx-community/embeddinggemma-2-5bit`.

Native workers use offline mode and do not download missing weights. Review model
licenses before downloading or distributing them. Sidebar readiness reports
preparation and failure; “ready” does not establish speech or answer accuracy.
See [Model lifecycle](MODEL-LIFECYCLE.md) for implementation notes and historical observations.

## Engine tests without model downloads

```sh
python3 -m unittest discover -s src-tauri/resources/memory -p 'test_workspace_product.py'
python3 -m unittest discover -s src-tauri/resources/memory -p 'test_engine.py'
```

These deterministic tests cover journal and product behaviour using fixtures, not
native media devices or live model inference.

## Workspace fixtures

Copy `memoria-demo/` to a temporary location before using it as a vault. Its people
and project scenario are fictional. Runtime journals, microphone recordings,
Python environments, and model weights are intentionally not versioned.

## Automation and history

The active GitHub workflow is `memoria-checks.yml`: frontend build, the scoped
Memoria suite, and deterministic engine tests. It does not claim full-suite or
native acceptance. Upstream CI and release workflows are archived under
`reference/upstream-workflows/` because their services and signing identities are
not Memoria infrastructure.

The Git hooks use the same local policy: a staged whitespace check before commit,
then build, scoped frontend tests, and deterministic Python tests before push.
The original hooks are archived with the upstream workflow references. The known
full-suite failures remain documented rather than represented as passing checks.

`main` is the desktop workspace, `legacy` preserves the prior default Next.js app,
and the existing `fyp2` and `master` branches retain their historical contents.
