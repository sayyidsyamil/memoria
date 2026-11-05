# Documentation

Memoria's own documents. `ABSTRACTIONS.md`, `PERFORMANCE.md`, `VISION.md`, `MOBILE-UI-PARITY.md`,
`PUBLIC-DOCS-PLAN.md`, `adr/` and `web/` are inherited from Tolaria and describe the upstream workspace.

## Install and develop

- [GETTING-STARTED.md](GETTING-STARTED.md): the inherited developer guide, and the
  [install for another macOS account (AC7)](GETTING-STARTED.md#install-for-another-macos-account-ac7).
- [DEVELOPMENT.md](DEVELOPMENT.md): development setup, model runtimes and model-free tests.
- [RELEASE_RECORD.md](RELEASE_RECORD.md): the current UAT build, its checksums and its smoke test.
- [CALL-AUDIO-TEST.md](CALL-AUDIO-TEST.md): call-audio checks, observed results and untested cases.
- [ROADMAP.md](ROADMAP.md): milestones M0 to M7 and their status.

The October build's deployment guide, cited by the FYP2 report as `docs/DEPLOYMENT.md`, is on the
`fyp2` branch (tag `v0.1.0-uat`), not on `main`.

## How it works

- [ARCHITECTURE.md](ARCHITECTURE.md): Memoria's meeting, ledger and live-check sections, then the
  inherited Tolaria architecture.
- [MODEL-LIFECYCLE.md](MODEL-LIFECYCLE.md): the three resident model workers, their memory and restarts.
- [MEETINGS-API.md](MEETINGS-API.md): the meeting record API and crash-safe saves.
- [TEMPORAL-API.md](TEMPORAL-API.md): the decision ledger API, the live check and Live Ask.
- [MEMORY-ENGINE.md](MEMORY-ENGINE.md): reviewed knowledge pages built from sources.
- [IMPORT-REVIEW-FLOW.md](IMPORT-REVIEW-FLOW.md): importing a file and reviewing the knowledge built from it.
- [UI-PATTERNS.md](UI-PATTERNS.md): the meeting surfaces, shared components and interface rules.

## Evidence

- [`../research/`](../research/): the evaluations (ledger, MemoriaBench, live check, live speech, app
  parity, stronger and larger models), with scripts and results.
- [`research/`](research/): native checks of the installed app
  ([M1](research/M1-NATIVE-LOOP.md), [M2](research/M2-MEETING-INTELLIGENCE.md)), the
  [evidence inventory](research/RESEARCH-EVIDENCE.md) and the speech and model smoke tests.
- [WORKSPACE-PRODUCT-VERIFICATION.md](WORKSPACE-PRODUCT-VERIFICATION.md): test-suite runs and native
  checks, newest first.
- [M3-FULL-SUITE-TRIAGE.md](M3-FULL-SUITE-TRIAGE.md): how the full frontend suite reached zero
  failures on 2 November 2026.
- [SPEECH-BAKEOFF.md](SPEECH-BAKEOFF.md), [SPEECH-COMPARISON-2026-10-31.md](SPEECH-COMPARISON-2026-10-31.md):
  the speech-model spikes of 31 October 2026.
- [`notes/`](notes/): dated working notes, not maintained.
