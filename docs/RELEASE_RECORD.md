# Release record

| | |
|---|---|
| Version | 0.2.0 |
| Built on | 2026-11-02 20:03 +0800 |
| Git commit | `fdaf1999ab6aeccf13cf44daa66f1659869a9c19` |
| Disk image | `Memoria_0.2.0_aarch64.dmg` (18M) |
| Disk image SHA-256 | `93be3b6f24b47e2cb98a170c31ed23a6274ed7e5395cf6490b0da2b143076786` |
| Machine | Apple M5, macOS 26.7.1, arm64, 16 GB |
| rustc | rustc 1.99.0 (b940084d7 2026-09-28) |
| cargo | cargo 1.99.0 (5f94df478 2026-08-27) |
| node | v24.15.0 |
| pnpm | 10.34.8 |
| tauri-cli | tauri-cli 2.12.1 |
| Telemetry keys | none in the environment or .env files; `dist/` scan clean |
| Bundle check | memory/engine.py, memory/live_assistance.py, memory/memoria_engine present; no __pycache__ |

App binary SHA-256 (`Memoria.app/Contents/MacOS`):

```
e3c4fe127008f19d3770961397a83542e55049962063e56958cc9431ab953d8f  memoria
```

The build is ad-hoc signed and not notarised, so on another Mac the first open needs right-click >
Open. It does not contain the Python runtimes or the models: on the build Mac they come from the
developer runtimes or the shared install in `/Users/Shared/Memoria` (`scripts/install-shared-runtime.sh`,
any account of this Mac); `scripts/uat/memoria-doctor.sh` checks an account before use.

## Smoke test (2 November 2026, this Mac, no UI input)

Installed from the disk image into `/Applications` (the 0.1.0 app moved to `~/Backups`), then
`memoria-doctor.sh` printed READY. The three workers ran from the shared install and were ready
10 to 23 s after launch. Through the installed app's workers, on a fresh copy of the starter vault:

| Check | Result |
|---|---|
| T1: take in the three meetings | 65 s; 17 proposals, all matching the answer key, all 15 events found |
| T4: the three recall questions | 9 Nov 2026; 250,000; "changed once" |
| T5: brief | Open commitments: Staff training (Raj, due 3 Nov 2026), Data migration (Wei Ling, due 23 Oct 2026) |
| Bundled engine (`Contents/Resources/memory/engine.py`) | Answers with the approved quote as citation |
| Qwen worker killed (`kill -9`) | Restarted by the app after 4 s; a live check of "Gamma Solutions is our vendor now." then raised a cue citing "We drop Alpha Systems and move to Beta Cloud. This is final." |
| `codesign --verify --deep --strict` after the run | Passes; no `__pycache__` written into the app |

Not covered here: a microphone recording, the visual interface, and another macOS account (AC7).
