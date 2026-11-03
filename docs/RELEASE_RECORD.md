# Release record

**Local UAT candidate, not published.** The corrected 0.3.2 installer is installed on
the developer's Mac. Native acceptance checks and participant UAT remain pending.
The published installer is still [`v0.3.1-uat`](releases/v0.3.1-uat.md).

On the build Mac, the verified DMG and `SHA256SUMS` are retained in
`/Users/Shared/Memoria/installers/0.3.2-169ce3d96/`. Presenter-only opening and
reviewed templates are `demo-opening-0.3.2-169ce3d96` and
`demo-reviewed-0.3.2-169ce3d96` under `/Users/Shared/Memoria/`; core participant
tasks still start from the separate pristine `demo-vault`.

| | |
|---|---|
| Version | 0.3.2 |
| Built on | 2026-11-04 03:28 +0800 |
| Git commit | `169ce3d9604c5a4fa2ce8a4f850f8bb150f4192b` |
| Disk image | `Memoria_0.3.2_aarch64.dmg` (18M) |
| Disk image SHA-256 | `06bde921a77d5bb09ac9bc5597cbe339208734998150e7f7000e1157616a2246` |
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
7a65a5da4762ed0d28efa86f024b6858b2ddd743294811311c3ab0f51d287ea4  memoria
10958a86bdebced19d58f656582ec09befeae99192995c3d9071193fc8d35e3f  memoria-call-audio
```

The build is ad-hoc signed and not notarised, so on another Mac the first open needs right-click >
Open. It does not contain the Python runtimes or the models: on the build Mac they come from the
developer runtimes or the shared install in `/Users/Shared/Memoria` (`scripts/install-shared-runtime.sh`,
any account of this Mac); `scripts/uat/memoria-doctor.sh` checks an account before use.

## Verified candidate checks — 4 November 2026

The exact `/Applications/Memoria.app` installed from this DMG ran on a disposable
vault. Calls used its bundled engine and app-owned resident workers. Review actions
were scripted and labelled `Release smoke (script)`; no participant data were used.
The [machine-readable receipt](releases/v0.3.2-candidate-smoke.json) preserves the
proposals and assertions with host-specific temporary paths removed.

| Check | Result |
|---|---|
| DMG and application | DMG verification and strict/deep ad-hoc signature passed |
| Bundle/source identity | 60 memory source files matched; no bundled bytecode; 429 protected tracked entries retained hashes, sizes and modification times |
| Setup doctor | READY on the developer account with the existing shared runtimes/models |
| Take in three fictional meetings | 29.70 s; 17 proposal values matched the key; all 15 expected changes found; quote provenance checked |
| Current, past-date and change-count questions | 9 Nov 2026; RM 250,000 on 27 Sep; one go-live change |
| Vendor history | Beta Cloud current; Alpha Systems on 27 Sep; both cited |
| Corrected owner in Ask and Live Ask | Raj with the scripted reviewer's reason; manual provenance separate from the original claim date and source context |
| Brief and saved Markdown | Raj / 3 Nov and Wei Ling / 23 Oct; separate owner-correction and deadline citations; correction reason and fact dependency saved |
| Live-check probes | Vendor mismatch cued; correct vendor and budget statements raised no cue |
| Qwen child replacement | Replacement process appeared after 3.89 s; subsequent vendor check passed. This is not a readiness-latency measurement |
| After the checks | Ledger invariants and signature passed; app/workers stopped; normal workspace registry byte-identical to its pre-test copy |

The 17 values, quotes, speakers and meeting IDs match the
[withheld first candidate](releases/v0.3.2-candidate1.md). These fictional meetings
were already used for extractor repairs; the run is an integration check, not an
independent model-accuracy result. No model weights, prompts or extraction policy
changed in the correction-provenance fix.

Automated checks: **6,821 frontend tests** (709 files, one skipped), **243 app Python
tests**, type checking, lint and **21 locale catalogs / 1,365 keys** passed. The
**1,245 Rust tests** (two ignored) passed during 0.3.2 preparation; no Rust code
changed afterward. Separate tooling suites passed seven C1-fixture tests and 14
private UAT-analysis tests. The six native audio lifecycle checks belong to 0.3.1,
not a new native test of this candidate.

## Browser checks and remaining work

The browser frontend using real disposable app data demonstrated the Alpha-approved
→ Beta-proposed → explicit acceptance → Beta-current flow, with Alpha retained in
history and its source opened at 55.21 s. C1 correctly rejected the planted budget
attribution and accepted its supported deadline control. Browser audio playback and
seeking passed with a test-only allow-list for the fixture directory.

After the provenance fix, browser Ask and briefs displayed the correction reason
and original context distinctly; saving produced the corresponding Markdown. The
1440 px and 480 px layouts fit without horizontal overflow. Without a resident
model, the short owner question needed `now` for the rules-only route; the shorter
question passed with the installed production router. A browser mock does not open
the native note window, so reopening the saved brief still needs a native check.

The Mac reported no active display and no visible Memoria window. Native T1–T5,
playback/seeking/recovered duration, headset/device switching, denied audio
permissions, clean-account AC7 and installed voice-consent/deletion AC8 remain
unverified. Shared helpers are updated, but provisioning is not clean-account
acceptance. Participant sessions and supervisor/collaborator sign-off have not occurred.

One preflight caught macOS resolving the bundle ID to an old debug app and stopped
before inference or vault copying. That instance was closed. The passing run used
an explicit `/Applications/Memoria.app` launch and checked its process path.
