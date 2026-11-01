# Memoria roadmap

This is an acceptance-oriented roadmap for the research prototype, not a release
schedule. Current evidence is recorded in [WORKSPACE-PRODUCT-VERIFICATION.md](WORKSPACE-PRODUCT-VERIFICATION.md).

## 1. Complete the native meeting loop

- Verify the HUD first-click behaviour and microphone-permission hint.
- Exercise Record → mark → pause/resume → End → saved review with real audio.
- Verify Summary → Create brief, Ask, Approved, and Briefs in the installed app.
- Check narrow layouts and both themes natively.
- Demonstrate knowledge reuse across two meetings, with inspectable citations.

Acceptance: recording stops cleanly, marks align with recorded time, reviewed state
survives restart, and a saved brief cites only eligible approved evidence.

## 2. Reproducible local setup

- Pin and document separate speech, language, and embedding environments.
- Provide explicit model setup and actionable readiness diagnostics.
- Remove developer-machine path fallbacks from supported installation paths.
- Package a signed application and runtime with model-license documentation.

Acceptance: a clean Apple Silicon machine can follow a documented setup without
depending on the original developer's directories.

## 3. Evaluate meeting intelligence

- Measure ASR and speaker-label accuracy on held-out English and Malay recordings.
- Compare lexical retrieval with hybrid retrieval on a controlled question set.
- Evaluate citation entailment, omissions, and changed-source handling.
- Assess multiword project scopes, historical queries, and conflicting decisions.

Acceptance: repeatable evaluation protocols and reported results, including failure
cases. Exact quote validation alone is not an accuracy metric.

## 4. Reliability and longer meetings

- Recover interrupted captures before End creates a permanent meeting record.
- Add chunked long-recording transcription beyond the current ten-minute path.
- Evaluate sleep/wake, microphone disconnection, queue pressure, and low disk space.
- Add memory-pressure handling and coordinate resident model work.

Acceptance: captured audio is recoverable and failures are visible without silently
promoting incomplete transcripts into reviewed knowledge.

## 5. Release readiness

- Reconcile the 97 outstanding full-suite failures recorded on 1 November 2026.
- Verify fresh installs, upgrades, and private-data boundaries.
- Establish Memoria-owned release automation and a supported-platform matrix.
- Document inherited integrations separately from the local meeting workflow.

The scoped Memoria CI is a useful development check, not full release certification.
