# Notice and credits

## Origin of this code base

Memoria's desktop shell is a **modified fork of Tolaria** (<https://github.com/refactoringhq/tolaria>, by Refactoring), a desktop application for markdown knowledge bases. Tolaria is licensed under the **GNU Affero General Public License v3.0**, and so is this repository (see `LICENSE`). Anyone who receives a build of Memoria must be able to get the corresponding source; this repository is that source.

The fork was made for a final-year project at Universiti Malaya. Most of the code in `src/` and `src-tauri/` is Tolaria's: the note editor, vault and git handling, search, command palette, settings, AI-agent panels, MCP server, and the Rust test suite that ships with them. Those tests are kept as a regression suite and are reported separately from Memoria's own tests.

## What Memoria adds

| Area | Files (main ones) |
|---|---|
| Live transcription bridge, speaker labels, opt-in voice profiles | `src-tauri/src/commands/transcribe.rs`, `src-tauri/resources/python/transcribe_server.py`, `transcribe_v3.py`, `src/components/LiveTranscribePanel.tsx` |
| Source import (files, web pages, links) | `src-tauri/resources/python/import_source.py`, `src/components/ImportSourcePanel.tsx`, `src/utils/sourceNoteMetadata.ts` |
| Inbox workflow and meeting events | `src/components/note-list/InboxWorkflowPanel.tsx`, `src/utils/memoriaWorkflow.ts` |
| Decision and commitment ledger (bridge and screens) | `src-tauri/src/commands/ledger.rs`, `ledger_protocol.rs`, `src/components/LedgerPanel.tsx`, `src/components/ledger/`, `src/lib/ledgerApi.ts`, `src/lib/transcriptNote.ts` |
| Safety changes to inherited code | in-app updater disabled (`src-tauri/src/app_updater.rs`, `tauri.conf.json`), so a build never fetches code signed by someone else |

The **decision and commitment ledger engine** (`../engine`, Python) is original work for this project and is not derived from Tolaria. The desktop app talks to it through a small JSON-over-stdin/stdout interface.

## Third-party models and libraries (used at run time, not bundled)

| Component | Use | Licence |
|---|---|---|
| Qwen3.5-4B (MLX 4-bit) | local language model for extraction and question routing | Apache-2.0 |
| NVIDIA Parakeet TDT 0.6B v3 (MLX) | speech recognition | CC-BY-4.0 |
| NVIDIA Streaming Sortformer 4spk v2.1 (MLX) | speaker separation | NVIDIA Open Model License |
| WeSpeaker VoxCeleb ResNet34-LM (MLX) | voice profiles, only if the user opts in | MIT |
| MLX, mlx-lm, mlx-audio | on-device inference on Apple silicon | MIT |

Models are downloaded from Hugging Face on first use and run entirely on the user's computer. Check each model card for the current terms.

## Data

Meeting audio, transcripts, voice profiles and the ledger stay on the user's machine. The fictional demo meetings in `../engine/data/demo` contain invented people, vendors and numbers. The real-meeting evaluation uses the AMI Meeting Corpus (CC BY 4.0).
