# Memoria roadmap

The plan to complete Memoria: first a submission-ready FYP2 prototype, then an installable
product. Each milestone ends with an acceptance check; a milestone is done when its check
passes on the installed app, not when code merges. Current evidence is recorded in
[WORKSPACE-PRODUCT-VERIFICATION.md](WORKSPACE-PRODUCT-VERIFICATION.md) and
[research/](../research/).

Week numbers follow the WIA3003 semester (week 2 ended 16 October 2026); adjust them to the
faculty calendar. User acceptance testing (UAT) is planned for weeks 8 to 10.

| Milestone | Target | Outcome |
|---|---|---|
| M0 Consolidated | Done, 2 November | One repository, research evidence, backup, private report folder |
| M1 Native meeting loop | Week 5–6 (mostly done 2 Nov) | Record → review → approve → reuse works in the installed app with real audio |
| M2 Meeting intelligence | Week 6–7 | Measured live check, long meetings, safer tracked facts |
| M3 Reliability | Week 7 | Recovers from failures; full test suite green |
| M4 UAT build | End of week 7 | Tagged build that installs from the guide |
| M5 Evaluation and UAT | Weeks 8–10 | Participant results and current-app measurements |
| M6 Report and viva | Weeks 10–14 | Report complete, viva ready |
| M7 Installable product | After M4, in parallel | Installs and runs on a clean Mac without developer folders |

## M0 Consolidated (done)

- Memoria lives in this repository only. Earlier versions were removed after a verified
  backup (`~/Backups/memoria-2026-11-02`); the FYP2 app remains on branch `fyp2`
  (tag `v0.1.0-uat`).
- Engine evaluation and MemoriaBench moved to [research/](../research/); 291 engine tests and
  900 MemoriaBench checks pass from there.
- Report, slides, UAT kit and admin documents are private, in `~/Documents/Memoria-FYP`.
- The app no longer depends on the retired `~/Documents/memoria` folder.

## M1 Native meeting loop

- Record, mark, pause and resume, End, then review with real microphone audio.
- Recover an interrupted recording through the new recovery flow, natively.
- Verify Live Ask and the final turn on End in the installed app.
- Summary → approve → Ask, Search and saved Briefs; reuse knowledge across two meetings.
- Fix the observed UX issues: raw JSON query results, "1 changes", machine dates and UUID labels.
- Check the HUD's first click, the microphone-permission hint, narrow layouts and both themes.

Acceptance: recording stops cleanly; marks align with recorded time; reviewed state survives
restart; an interrupted recording is recovered; a saved brief cites only approved evidence.

Status (2 November): verified natively with the replay path and fictional fixtures — see
[M1-NATIVE-LOOP.md](research/M1-NATIVE-LOOP.md). Capture, captions, marks, pause/resume, End,
review, refine, speaker naming, knowledge review and apply, Ask, Brief, Search, tracked facts,
restart persistence and crash recovery all work; 14 defects found on the way were fixed with
tests. Remaining: microphone capture with real speech (permission prompt), visual checks of
themes, narrow layouts and the HUD's first click (no Screen Recording permission was
available), and a playable duration for recovered recordings (D13).

## M2 Meeting intelligence

- Bring the evaluated guard (relevance → confirmation → attribution, `research/memoriabench/guard.py`)
  into `live_assistance.py`, then score the app's live check on MemoriaBench.
- Long meetings: chunked transcription beyond the current ten-minute limit, and windowed
  tracked-fact extraction (reuse `memoria_engine.windowed`).
- Tracked facts: stop offering registry edits that the ledger refuses.
- Make saving across SQLite and Markdown recoverable after a crash (meetings API).
- Route current-value and change questions in Ask to the tracked-fact ledger: the M1 check
  answered "Which supplier do we use now?" with "does not answer" although tracked facts held
  the current value.
- Offer existing People and previously named voices in the speaker picker; label history
  headings with the item label rather than its ID.

Acceptance: a 60-minute recording is transcribed and extracted with no silent truncation; the
live check has a reported MemoriaBench score with intervals and failure cases.

## M3 Reliability

- Restart crashed model workers automatically; handle memory pressure; coordinate model use
  across the three workers. (Workers no longer outlive a crashed app — done in M1.)
- Write a playable duration for recovered recordings without altering the original evidence.
- Sleep and wake, microphone disconnection, queue pressure and low disk space.
- Resolve the 97 full-suite failures recorded on 1 November: fix them, or remove tests for
  inherited features that Memoria hides.

Acceptance: the full frontend suite passes; each failure mode above has a documented, tested
behaviour that never promotes incomplete transcripts into reviewed knowledge.

## M4 UAT build

- Tag `v0.2.0-uat` and publish the app bundle as a GitHub release with notes.
- Fictional demo vault and reset script for sessions; UAT protocol and forms ready.

Acceptance: a second macOS account installs and completes the five acceptance tasks by
following the guide alone.

## M5 Evaluation and UAT

- UAT with 6–8 participants: task success, SUS, acceptance criteria AC1–AC8, signed acceptance.
- Speech: WER and speaker-label accuracy on held-out English and code-switched Malay recordings,
  using the current speech pipeline.
- Live latency: P50 and P95 from speech to caption, and from caption to evidence cue.
- Retrieval: lexical against hybrid on a controlled question set; citation entailment,
  omissions and changed-source handling.

Acceptance: repeatable scripts under `research/`, reported results including failures. Exact
quote matching alone is not an accuracy metric.

## M6 Report and viva

- Supervisor decisions: final title; MemoriaBench as a fourth objective or an extension; whether
  the AP1 collaboration letter covers AP2.
- Fill the report's 14 `[PENDING]`, 26 `[TBD]` and 8 `[CONFIRM]` markers and the slides'
  18 `[FILL]`s; reconcile the engine test count (271 in the report, 291 now).
- Point the report's appendix generator at `research/ledger-engine`; record the demo video.

Acceptance: report and slides contain no placeholders; every number traces to a file in
`research/` or the UAT records.

## M7 Installable product

- **Runtimes:** replace the three developer environments (`.speech-runtime`, `.embed-runtime`,
  Homebrew `python3.11`) with a relocatable Python runtime and pinned, hashed requirements,
  shipped in the app or installed on first run into Application Support.
- **Models:** first-run download with progress, disk-space check, resume and SHA-256
  verification; offline afterwards; licence notices for Qwen, EmbeddingGemma, MOSS and
  Resemblyzer.
- **Paths:** remove compile-time developer fallbacks (`CARGO_MANIFEST_DIR`) and readiness
  messages that mention developer folders.
- **Release:** release (not debug) build, DMG, Memoria-owned update channel. Signing is ad-hoc
  unless an Apple Developer ID is obtained; notarisation needs the paid Apple Developer Program.
- **Scope:** hide or remove inherited Tolaria features that are not part of Memoria (agent
  integrations, mobile, collaboration) and document what remains.
- **Boundaries:** verify fresh installs, upgrades and private-data boundaries; publish the
  supported-platform matrix (Apple silicon, 16 GB minimum).

Acceptance: a clean Apple-silicon Mac installs the DMG, downloads models, records a meeting
and answers a cited question without any developer folder, terminal step or network access
after setup.

## Decisions needed

- Apple Developer Program membership for notarisation (cost), or ad-hoc signing.
- Which inherited Tolaria features remain visible in the product.
- Supervisor: title, MemoriaBench's place in the report, collaboration letter scope.
