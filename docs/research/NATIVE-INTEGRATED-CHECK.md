# Installed native temporal workflow check

Verified on 2 November 2026, completed at `2026-11-02T00:23:55Z`:

- Installed latest timing-patched bundle at `~/Applications/Memoria Workspace.app`
  after graceful quit. New process PID 92780, window `w-26721`.
- Speech, Knowledge and Search footer statuses reported Ready.
- Opened disposable `opencode/native-integrated-check/vault` through native picker.
- Saved Supplier / decision / text attribute value through native tracked-item setup.
- Opened two prepared reviewed meetings; invoked Find tracked fact suggestions.
  Real workspace Qwen extraction produced Beta and Acme proposals; explicitly
  accepted both using native controls.
- Current fact showed Acme, history showed Beta and Acme. Native queries returned
  one change and historical Beta on `2026-10-10`, with Maya, correct meeting UUIDs,
  and exact `audio_start: 12.5` evidence offsets.
- Graceful quit/relaunch (PID 20797, window `w-27276`) retained workspace and history.

This verifies native UI → Tauri → packaged Python → real Qwen → persisted ledger.
It is not human UAT, speech accuracy evaluation, or complete live acceptance.

## Fixture

Packaged meeting services prepared fictional reviewed sources: Maya said
“We decided to use Beta as supplier.” on October 1 and the corresponding Acme
statement on October 20, both at +12.5 seconds. These are manually prepared fixture
words, not ASR output. Initial fixtures lacked audio, and native review directed the
user to the document. Added a labelled 16-second silent WAV through the meeting
service to open review. That audio does not contain the fixture words. No microphone
was activated.

Native operations used agent-desktop accessibility and window-bounded screenshots.
AX field writes did not consistently commit React state; headed typing did. Folder
and select controls required explicit focus and observation.

Scratch `opencode/native-integrated-check/` retains `prepare.py`, `add_audio.py`,
`fixtures.json`, the disposable vault, `change-count.png`, and
`history-after-restart.png`.

## Follow-ups

Observed UX: query results render raw JSON, current fact says “1 changes”, dates
are machine-formatted, and citations show UUIDs rather than meeting titles (all
fixed in [M1](M1-NATIVE-LOOP.md)).

Not exercised: native correction/retraction, Live Ask, native capture, End/final-turn
processing, trimmed-caption review rendering, crash recovery, full capture queue
and latency. These remain separate acceptance checks.
