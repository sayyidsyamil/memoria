# Network and privacy check (Memoria app, branch fyp2)

First run 2026-10-13, refreshed 2026-10-14 with `scripts/privacy-check.sh` (read-only; greps `index.html`, `src/` and `src-tauri/src/` excluding tests, mocks and comments; lists the CSP; scans `dist/` if present). Static analysis only: no traffic was captured and no app was launched.

## Verdict (refreshed 2026-10-14, after Part 5)

**No unconsented contact at start-up was found.** The Google Fonts request that the first run of this check found in `index.html` is gone: Inter, IBM Plex Mono and JetBrains Mono are bundled (`@fontsource`, OFL, `src/fonts.ts`), and a fresh `vite build` of `dist/` contains no `fonts.googleapis.com` or `fonts.gstatic.com` reference. With no Sentry/PostHog keys (no `.env`, `VITE_SENTRY_DSN` and `VITE_POSTHOG_KEY` unset) telemetry is inert, the consent dialog is not shown, and `dist/` (rebuilt today) holds no DSN or key. A headless browser run of the app in mock mode requested resources from `localhost` only. The only unprompted outbound traffic left is the **one-time model download from huggingface.co on first use**, which happens in the Python scripts, not in the Tauri app. This is static analysis plus that browser check; no packet capture of the packaged app was done.

### CSP that remains (`src-tauri/tauri.conf.json`, release)

| Directive | Value |
|---|---|
| default-src | `'self' ipc: http://ipc.localhost` |
| script-src | `'self'` |
| connect-src | `'self' ipc: http://ipc.localhost data: ws://localhost:9710 ws://127.0.0.1:9710 ws://localhost:9711 ws://127.0.0.1:9711` |
| style-src / style-src-elem / style-src-attr | `'self' 'unsafe-inline'` / `'self' 'nonce-memoria-runtime-style'` / `'unsafe-inline'` |
| font-src | `'self' data:` |
| img-src, media-src | `'self' asset: http://asset.localhost data: blob: https:` (kept on purpose: a note may embed a remote image the user chose; such an image is fetched when the note is displayed) |
| object-src, frame-src | `'self' asset: http://asset.localhost` (frame-src also `blob: data:`) |

`src/lib/securityConfig.test.ts` fails if a Google font host, a PostHog host or an open `connect-src https:` reappears, or if `index.html` loads anything from a remote host.

## Findings

| Class | Count | Where | Contacted when |
|---|---|---|---|
| model download (huggingface) | 4 model ids | `src-tauri/resources/python/transcribe_v3.py` (parakeet, sortformer, wespeaker; `hf_hub_download`), `engine/memoria_engine/service.py`, `extractors.py`, `llmcache.py` (Qwen3.5-4B-MLX-4bit) | First transcription or first ledger extraction, only if the model is not already in the Hugging Face cache (about 5 GB). **No in-app prompt before it starts.** |
| user-initiated (install/docs link) | 14 | `aiAgents.ts`, `*_cli.rs`, `*_discovery.rs`, Claude Code prompt/badge (docs.anthropic.com, openai.com, opencode.ai, pi.dev, kiro.dev, google-gemini.github.io) | Only when the user clicks an install link in an AI-agent panel. The AI-agents onboarding prompt is now off by default. |
| user-initiated (git remote) | 9 | `CloneVaultModal`, `AddRemoteModal`, `git/*` | Only if the user adds or clones a remote. The starter vault has its remote removed; `git_pull` returns `no_remote` without any network call. |
| user-initiated, hidden | 7 | `src/constants/feedback.ts` (refactoring.fm, canny, upstream GitHub) | Never reachable: `SHOW_UPSTREAM_LINKS=false` hides every entry. |
| updater (disabled) | 4 | `app_updater.rs` (api.github.com, refactoringhq.github.io), `useUpdater.ts`, `releaseDownloadPage.ts` (memoria.md) | Not called: the frontend gates the update check with `SHOW_UPSTREAM_LINKS`; `tauri.conf.json` has empty updater endpoints and no pubkey. The Rust code and `tauri-plugin-updater` are still compiled in. |
| telemetry (inert unless keys) | 1 URL (`us.i.posthog.com`), Sentry/PostHog init sites in `lib/telemetry.ts` and `telemetry.rs` | Requires a compiled-in key **and** `telemetry_consent`/`crash_reporting_enabled`/`analytics_enabled`. With no keys the app now stores all three as `false` silently and never asks. |
| local | 3 | `ws://localhost:9710` (MCP bridge), `ws://localhost:9711` (AI activity), `asset.localhost` | Loopback only. |
| other | 7 | JSON schema ids (`opencode.ai/config.json`, strings, not fetched), URL prefix checks, placeholders | Not contacted. |
| AI provider API (`reqwest` in `ai_models.rs`) | 1 call site | Endpoints come from the provider the user configures with their own key | Only when the user runs a chat with an external provider. Not used by Memoria's ledger. |

`dist/` scan: **PASS**, no Sentry DSN and no PostHog key (dist rebuilt on 2026-10-14). `scripts/build-release.sh` repeats this scan on every release build and fails if it finds a key.

## Surprises and things to know

1. **Silent model download.** First use of live transcription, import or the ledger (with `mlx`) downloads about 5 GB from huggingface.co without an in-app question. For a UAT on a clean machine this needs internet once (`scripts/memoria-doctor.sh` says so). Participants with no network will see a failure, not a prompt.
2. **Upstream URLs still in the binary.** `app_updater.rs` and `useUpdater.ts` still hold `refactoringhq/memoria` and `memoria.md` URLs and the updater plugin is registered. They are unreachable at present but a one-flag change would revive them.
3. **Release-notes page fetch.** `releaseHistoryPage.ts` can `fetch` a notes URL inside a generated HTML page; it is only reached from the upstream release-notes view, which is not opened in this fork.
4. **Git auto-sync timer** (`useAutoSync`, every 5 min) runs when the vault is a git repo, but makes no network call when there is no remote (the default for the demo vault).
5. The whole-app check is static; a packet capture of a first run (for example with `nettop` or Little Snitch in a clean account) would turn "no path found" into "none observed".

## Suggested fixes (not applied; this step reports only)

1. Add a one-time "download models (about 5 GB) from huggingface.co?" confirmation before the first download, or ship the models in the release; set `HF_HUB_OFFLINE=1` for the Python child processes once the doctor script sees all four models cached.
2. Remove `tauri-plugin-updater`, `app_updater.rs`, the `updater:default` capability and the `memoria.md` constants for the release build, or put them behind a Cargo feature.
3. Add `scripts/privacy-check.sh` to the release checklist and run it after `pnpm build` so the `dist/` scan is meaningful; fail the release if it finds a key.
4. Optional: also remove `https:` from `img-src` and `media-src` to stop remote images in notes from being fetched (it would break notes that embed web images).
5. Done in Part 5: Google Fonts removed, CSP tightened (see above).
