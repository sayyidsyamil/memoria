# Release record

**Candidate 1, not published.** A correction-provenance defect found in browser QA
blocks this build. Its measurements are archived in
[`releases/v0.3.2-candidate1.md`](releases/v0.3.2-candidate1.md); a corrected build is pending.

| | |
|---|---|
| Version | 0.3.2 |
| Built on | 2026-11-04 01:31 +0800 |
| Git commit | `f3259684e39115311c94f63de7224a5322dc2e63` |
| Disk image | `Memoria_0.3.2_aarch64.dmg` (18M) |
| Disk image SHA-256 | `f7b3cbecc079ba6b8be3092c453ed8226b36194289e0e271b0200628a254a388` |
| Machine | Apple M5, macOS 26.7.1, arm64, 16 GB |
| rustc | rustc 1.99.0 (b940084d7 2026-09-28) |
| cargo | cargo 1.99.0 (5f94df478 2026-08-27) |
| node | v24.15.0 |
| pnpm | 11.1.1 |
| tauri-cli | tauri-cli 2.12.1 |
| Telemetry keys | none in the environment or .env files; `dist/` scan clean |
| Bundle check | memory/*.py, memoria_engine (with schema.sql and evaluation/router.py) present; no __pycache__; memoria-call-audio and NSAudioCaptureUsageDescription present |

Binary SHA-256 (`Memoria.app/Contents/MacOS`):

```
ac7964d0e2a69154056e5db08b6ff9353921d7f8bb9d24a656e1122ad7a6b4ef  memoria
10958a86bdebced19d58f656582ec09befeae99192995c3d9071193fc8d35e3f  memoria-call-audio
```

The build is ad-hoc signed and not notarised, so on another Mac the first open needs right-click >
Open. It does not contain the Python runtimes or the models: on the build Mac they come from the
developer runtimes or the shared install in `/Users/Shared/Memoria` (`scripts/install-shared-runtime.sh`,
any account of this Mac); `scripts/uat/memoria-doctor.sh` checks an account before use.
