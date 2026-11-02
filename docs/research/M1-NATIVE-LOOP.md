# M1 native meeting loop check

Verified on 2 November 2026 in the installed app (`~/Applications/Memoria Workspace.app`)
with a disposable copy of the fictional demo vault. Speech input came from the repository's
fictional acceptance fixtures (`scripts/create-live-acceptance-fixture.py`: macOS "Samantha"
text-to-speech, six sentences per meeting), played through the app's **Replay audio test**,
which runs the same capture, live caption, checkpoint, End and review path as a microphone
meeting without opening the microphone. This is not UAT and not a speech-accuracy evaluation.

## How the app was driven

- Main window: agent-desktop accessibility actions, and System Events where React re-renders
  made agent-desktop references stale.
- Meeting HUD: System Events only. The HUD is an always-on-top window that agent-desktop's
  window inventory does not list; System Events lists and operates it.
- No screenshots: Screen Recording permission was not granted to the automation process, so
  visual checks (themes, narrow layouts, HUD appearance) were not possible. Evidence is the
  accessibility tree, the files written to the vault, and the journal.

## Run 1 — first meeting (`baseline.wav`, 51.1 s), build before fixes

| Step | Result |
|---|---|
| Replay chooser → native Open panel → Start | Recording within 4 s (warm speech worker) |
| Live captions | All six sentences captioned during capture; checkpoints written every second |
| Audio accounting | 818,176 samples accepted and acknowledged, 0 refused, 0 unacknowledged (51.1 s) |
| Mark moment | 1 mark kept (0:51) and written to the meeting page |
| End → review | Review opened within 3 s; recording `published`, 49/49 chunks, SHA-256 recorded |
| Name speaker, save | All turns attributed to the named speaker in the page and transcript attachment |
| Summary → build knowledge | **Failed (D4)**; after the fix, 5 suggestions |
| Review and apply | One suggestion excluded; four applied with exact quotes and source links |
| Ask "Which supplier did we choose?" | "We decided to use Acme as supplier." with one citation, about 5 s |
| Brief, save | Five sections, saved page with an Evidence section quoting only approved claims |
| Hub: Search, Approved, Briefs, Meetings | Search "Acme": transcript line and approved claim with timestamp, 0.2 s; counts updated |

Turn start times against the fixture: 0:00 (0.5 s), 0:09 (9.9 s), 0:18 (18.3 s), a repeated
0:18 turn (D1), 0:22 for a sentence spoken at 26.7 s (D3), 0:34 (34.1 s), 0:42 (42.2 s).

## Run 2 — second meeting (`update.wav`, 52.1 s), build with fixes

| Step | Result |
|---|---|
| Pause after about 11 s, resume after 8 s | HUD showed Paused; recorded clock excluded the pause (00:52 for 52.2 s acknowledged) |
| Mark moment | "Marked 00:21" against a 00:20 recorded clock |
| Live captions | Six sentences, no repeated caption; the sentence the speaker really repeats was kept |
| Timing (draft) | All seven turns within 0.14 s of the spoken start; three timed from voiced audio |
| Refine transcript | Full-recording transcription corrected "Maja" to "Maya"; one speaker |
| Name speaker | Header "1 identified speaker" (D2 fixed); Meetings list shows the name |
| Summary → build knowledge | "4 suggestions · 3 new pages · 1 update" (D4, D5 fixed natively) |
| Apply | Failed on a page-title collision (D8); after the fix, "Rebuild this review" produced a new proposal that applied; the supplier page records Acme, then Beta, each with its quote |
| Meeting record pages | Unchanged by knowledge publication (D9 fixed) |
| Tracked facts | Pilot / supplier: Beta from meeting 2; Acme from meeting 1, imported afterwards, became history without replacing Beta; "1 change"; history and a "Changed once" lookup show both quotes with meeting titles and audio offsets (0:09, 0:17) |
| Ask across meetings | "Which supplier did we decide to use?" → Beta, cited to meeting 2 |
| Restart | Meetings, approved knowledge, briefs and tracked facts persisted across quit and relaunch |

Not answered well: "Which supplier do we use now?" returned "The reviewed knowledge does not
answer this", and "What changed about the supplier?" cited only meeting 2. Ask reads approved
wiki claims, not the tracked-fact ledger that already answers current-value and change
questions; routing such questions to tracked facts is planned work (roadmap M2).

## Run 3 — interrupted recording (crash during capture)

| Step | Result |
|---|---|
| Replay `baseline.wav`, then `kill -9` the app after 15 checkpoints | Recording journal left in `capturing` |
| Worker processes after the crash | Before the fix all three stayed resident (D12); with the fix they exited within 2 s |
| Relaunch → Meetings | "Interrupted recordings" listed the session: 15 checkpoints, 202.7 KiB, with a warning that the tail may be missing |
| Recover recording | Recording `published`, 15 chunks, `interrupted: true`; review opened with "Your recording is saved" and Create transcript |
| Recovered audio | 15.96 s decodable Opus; the WebM has no duration header, so the player showed 0:01 until a transcript existed (D13) |
| Create transcript | One turn; the opening sentence was dropped (D14) |
| Reopen from Meetings | "No readable speech was detected" and no way to transcribe (D15) |
| Repeat on the fixed build (14 checkpoints) | Workers exited within 2 s of the crash; recovery and Create transcript kept both sentences (D14 fixed), still as one glued turn (D16, then fixed and checked on the recorded model output); the earlier recovered meeting reopened with its transcript (D15 fixed) |

## Final smoke on the build with every fix

`update.wav` through live captions to End: 834,560 samples received and processed (52.2 s); all
seven turns within 0.5 s of the spoken starts, six with the model's own passage timing; no
repeated caption; the sentence the speaker really repeats kept and labelled as context-trimmed.
The live caption still heard "Maya" as "Maja"; Refine corrects it from the full recording.

## Defects found and fixed

| ID | Defect | Cause | Fix |
|---|---|---|---|
| D1 | A caption repeated with different number formatting ("$100" / "one hundred dollars") | MOSS sometimes times a passage as the whole 8 s window; midpoint ownership then assigned left-context speech to the next core | `live_speech.narrow_window_segments`: narrow whole-window segments to the window's voiced audio (WebRTC VAD) before ownership; keep the model span as `modelStart`/`modelEnd` |
| D3 | A turn timed 4.7 s before its speech | Same whole-window timing | Same fix; on the fixture audio the voiced spans were 0.54–3.90, 18.33–20.70 (not owned again) and 26.77–28.18 s |
| D4 | One suggestion with a destination page of another type aborted the whole knowledge build | `validate_claim` raised for a mismatched `targetPath` | The destination becomes a new page, the claim keeps its evidence check, and the proposal states how many destinations were changed |
| D2 | "No identified speakers" after naming the unknown speaker | `speakerOrder` always excludes `unassigned`, even when named | `identifiedSpeakers` counts the unknown voice once named (review header, Meetings list, avatar) |
| D5 | "1 updates" in the knowledge review header | No pluralisation | Uses the shared `plural` helper |
| D6 | Saved brief said "5 cited statements" when one statement had no citation | Count included uncited items | Counts only statements with citations |
| D8 | A second meeting's knowledge could not be applied: a new page title already existed, and "Compile again" returned the same cached review | New-page paths were derived at apply time from the title | New pages get a free numbered path when knowledge is built; a cached review is rebuilt once one of its new pages exists |
| D9 | After knowledge was appended to a meeting page, the meeting could not be saved ("edited externally") | The knowledge engine wrote to `meetings/meeting-<id>.md`, which the meetings service renders and guards by hash | Meeting record pages are never offered as destinations or written; older reviews aimed at them are rebuilt. The affected test page was restored from the journal receipt |
| D10 | The stale-review error no longer offered "Rebuild this review" (introduced while fixing D8) | The UI recognises "Compile again" in apply errors; the new message said "Build knowledge again" | Messages keep "Compile again"; a test pins the wording the UI relies on |
| D11 | A destination written as the text "null" was reported as a mismatched page | Small-model JSON | "null", "none" and empty destinations mean no destination |
| D12 | After the app was killed, its three resident model workers kept running (about 5 GB) | No parent-death handling; the next launch starts another set | Workers exit and remove their socket when re-parented; Qwen only in app-managed resident mode |
| D14 | A transcript silently lost its opening sentence | MOSS returned the passage without a speaker tag and the library's segment parser dropped it | Timestamped passages missing from the parsed segments are recovered from the model text and attributed to the unknown speaker (full-recording and live windows) |
| D15 | A recovered meeting reopened as "No readable speech was detected" with no way to transcribe | An empty saved turn list replaced the created draft's segments | Saved turns replace the draft only when there are any |
| D16 | Two sentences of an untagged recording came back as one 0–14.97 s turn reading "…test.We decided…" | The library parsed untagged output as one segment | When the model's timestamped passages hold exactly the parsed words, they are used, with the model's own timing (0.00–3.96 and 9.86–12.40 on the recorded output) |

D13 (recovered WebM without a duration header) is recorded, not fixed: the original evidence
file is kept byte-for-byte; a playable remux or decoder-derived duration is follow-up work.

Also fixed from the earlier native temporal check: tracked-fact query results showed raw
JSON, "1 changes", machine dates and meeting UUIDs. They now render readable values, correct
plurals, locale dates (calendar dates never shift) and meeting titles.

Observed, not changed:

- The speaker picker offers only "Add a name…", not existing People pages or the name used in
  the previous meeting (voice memory was off).
- The 4B model classed "Maya owns the pilot" as a Person, missed a budget sentence in run 1, and
  suggested merging the second meeting's generic "Audio replay test" claim into the first
  meeting's knowledge page; the reviewer excluded it. Extraction remains the quality limit.
- The "Interrupted recordings" guard shows while a HUD exists; by design, the recovery list is
  withheld then.
- History headings show the item ID ("pilot") rather than its label.
- Automation: accessibility briefly lost the main window after long operations, and once the
  window left the screen; actions were retried only after the window was visible again.
