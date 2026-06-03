# Memoria

Memoria is a local-first knowledge and notes app (Tauri v2 + React/TS frontend, Rust backend),
extended with on-device live transcription and speaker diarization (MLX).

## Dev

- Frontend dev server: `vite --port 5202 --strictPort`
- Native app: `pnpm tauri dev` (or `./node_modules/.bin/tauri dev`)
- Live transcription is bridged from `src-tauri/src/commands/transcribe.rs` to the
  Python pipeline at `/Users/sayyid/Documents/playground/transcribe_server.py`.

Keep changes surgical and the codebase clean.
