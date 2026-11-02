# Release record

| | |
|---|---|
| Version | 0.3.0 |
| Built on | 2026-11-03 04:03 +0800 |
| Git commit | `6222dbee2a276f9d2da46abdf59617025d752f4f` |
| Disk image | `Memoria_0.3.0_aarch64.dmg` (18M) |
| Disk image SHA-256 | `7f301e6e5e62a0d304fda392b80f15e1baa590c596b4283b4770c36a86dc8b4b` |
| Machine | Apple M5, macOS 26.7.1, arm64, 16 GB |
| rustc | rustc 1.99.0 (b940084d7 2026-09-28) |
| cargo | cargo 1.99.0 (5f94df478 2026-08-27) |
| node | v24.15.0 |
| pnpm | 10.34.8 |
| tauri-cli | tauri-cli 2.12.1 |
| Telemetry keys | none in the environment or .env files; `dist/` scan clean |
| Bundle check | memory/*.py, memoria_engine (with schema.sql and evaluation/router.py) present; no __pycache__ |

App binary SHA-256 (`Memoria.app/Contents/MacOS`):

```
2c6fea06adf0d21b4646c11526d40bb44e76628383a18c93bdd33346bfaff9fc  memoria
```

The build is ad-hoc signed and not notarised, so on another Mac the first open needs right-click >
Open. It does not contain the Python runtimes or the models: on the build Mac they come from the
developer runtimes or the shared install in `/Users/Shared/Memoria` (`scripts/install-shared-runtime.sh`,
any account of this Mac); `scripts/uat/memoria-doctor.sh` checks an account before use.

## Smoke test (3 November 2026, this Mac, no UI input)

Installed from the disk image into `/Applications`, then `memoria-doctor.sh` printed READY. The three
workers ran from the shared install and were ready 5 to 14 s after launch. Through the installed app's
workers, on a fresh copy of the starter vault:

| Check | Result |
|---|---|
| T1: take in the three meetings | 31 s; 17 proposals, all matching the answer key, all 15 events found |
| T4: the three recall questions | 9 Nov 2026; RM 250,000; "changed once" |
| T5: brief | Open commitments: Staff training (Raj, due 3 Nov 2026), Data migration (Wei Ling, due 23 Oct 2026) |
| Ask, five typed phrasings | Answered from tracked facts, each with its decision date |
| Qwen worker killed (`kill -9`) | Restarted by the app after 2 s; a live check of "Gamma Solutions is our vendor now." then raised a cue citing "We drop Alpha Systems and move to Beta Cloud. This is final." |
| Live meeting: two scripted meetings (53 s and 48 s, macOS voices) fed in real time to the installed app's speech worker, a live check on every committed turn | Sentences committed 0.45 to 2.1 s after they ended; the budget clash cued 0.46 s and 1.15 s after the statement, the vendor clash 1.01 s after it in the second meeting (misheard in one voice of the first); no false alarm; Live Ask 2.0 s cold, 0.8 s warm |
| Worker memory after the two meetings (`footprint`) | Speech 2.1 GB, Qwen 3.1 GB, search 0.9 GB |
| `codesign --verify --deep --strict` after the run | Passes; no `__pycache__` written into the app |

Not covered here: a microphone recording, the visual interface, and another macOS account (AC7).
