# Release record

| | |
|---|---|
| Version | 0.3.1 |
| Built on | 2026-11-03 12:30 +0800 |
| Git commit | `8cf25aca5e8eb478fa190a7e3e437add4e9f13ba` |
| Disk image | `Memoria_0.3.1_aarch64.dmg` (18M) |
| Disk image SHA-256 | `af3c2344c351aaec0f1608774013f9fd3055e163eeb8656662245c5a60793e8d` |
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
81d0e6419fc5a210b660b52b51c3ffa17fc89e324f5b31f9c2f4398f58a33f3a  memoria
10958a86bdebced19d58f656582ec09befeae99192995c3d9071193fc8d35e3f  memoria-call-audio
```

The build is ad-hoc signed and not notarised, so on another Mac the first open needs right-click >
Open. It does not contain the Python runtimes or the models: on the build Mac they come from the
developer runtimes or the shared install in `/Users/Shared/Memoria` (`scripts/install-shared-runtime.sh`,
any account of this Mac); `scripts/uat/memoria-doctor.sh` checks an account before use.

## Smoke test — 3 November 2026

Installed from this disk image into `/Applications/Memoria.app` and verified its signature. Requests went through the
bundled `memory/engine.py` and the installed app's resident workers, using a fresh copy of the fictional starter vault.
Each result was asserted against the demo answer key; no participant data were used.

| Check | Result |
|---|---|
| Shared-runtime doctor | READY for the installed 0.3.1 app and disposable vault |
| Take in the three meetings | 30.32 s; 17/17 proposals correct; all 15 expected events found |
| Accept proposals and correct the training owner | Passed; the correction to Raj was used by the brief |
| Current go-live date | 9 Nov 2026 |
| Budget on 27 September | RM 250,000 |
| Go-live change count | Changed once |
| Open commitments | Staff training: Raj, 3 Nov 2026; data migration: Wei Ling, 23 Oct 2026 |
| Live check | Vendor clash cued; correct vendor and budget statements raised no cue |
| Kill the app's Qwen worker | Replacement process appeared after 5.06 s; the subsequent vendor check passed |
| Bundle after testing | `codesign --verify --deep --strict` passed; no `__pycache__` written inside |

Automated checks: 6,805 frontend tests (709 files, one skipped), 1,245 Rust tests (two ignored), 216 Python tests,
six native Core Audio lifecycle checks; type check, lint and locale validation passed. See
[`WORKSPACE-PRODUCT-VERIFICATION.md`](WORKSPACE-PRODUCT-VERIFICATION.md).

Earlier on the same day, the bundled development build passed microphone and system-audio capture checks: a scripted
meeting produced both contradiction pop-ups; with microphone input at zero, call audio was still captioned and saved.
Those checks were on the development build, not a replay of this final disk image.

The final installed-player UI check was blocked: the Mac was locked with its lid closed, and desktop automation found
no active display. Playback/remux and recovery have unit and browser coverage; native playback and seeking still need
confirmation on this build. Clean-account installation, headset switching, denied system-audio permission and real
participant UAT remain outstanding.
