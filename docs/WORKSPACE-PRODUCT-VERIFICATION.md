# Permanent meeting workspace — 1 November 2026

## Meeting API migration — 2 November 2026

Meeting list/get/save/delete now use a typed frontend service and dedicated Tauri
command, with Python application-service/repository ownership and structured error
codes. Existing action names delegate to the same backend implementation for
compatibility. Contract tests cover malformed responses, coded conflicts, restart
persistence, and restoring a generated document when database publication fails.
See [MEETINGS-API.md](MEETINGS-API.md) for the precise boundary and remaining scope.
Transcription, knowledge, search, briefs, and crash-atomic recovery are not claimed
as migrated. The debug bundle builds; native UI acceptance of this API migration
has not yet been performed.

## Meeting deletion — 2 November 2026

Each Meetings row now offers Delete meeting with a confirmation describing the
scope. The action removes the database record and generated Meeting Markdown;
original audio, reviewed sources, approved knowledge, and voice profiles remain.
Externally edited meeting documents block deletion. Repeating a successful delete
is harmless. List/count refresh follows deletion. Engine tests verify persistence,
evidence preservation, and external-edit conflicts; UI tests cover confirmation,
success and failure. The debug build was installed and row actions were inspected;
native deletion itself was not performed on the existing test records.

## Bottom runtime status — 2 November 2026

The small sidebar AI readiness label was removed. The native footer now displays
Speech, Knowledge, and Search runtime states separately, with error details on
hover. A window-scoped agent-desktop screenshot of the installed build confirmed
Speech: Ready, Knowledge: Ready, and Search: Preparing. Three focused status tests
cover mixed readiness, unavailable responses, and malformed individual workers.
TypeScript, scoped lint, and the native debug build pass. The narrow-width wrapping
rule is implemented but was not inspected in the native window during this check.

## Navigation consistency follow-up

The installed desktop build now separates meeting navigation from an expandable
Document library. Both expanded and collapsed states were inspected natively with
agent-desktop. Existing type and saved-view actions pass their targeted tests.
Meetings/briefs sort newest-first in the frontend, malformed list responses fail
visibly, and stale list responses cannot replace a newer tab's loading/error state.
The scoped frontend suite now passes 69 tests. Live recording, native dark mode,
and minimum-width interaction checks were not performed in this follow-up.

## Experience refinement — 2 November 2026

Visible memory-page headings, a concise outcomes overview, a single brief action,
and a quieter timestamp timeline replace repeated explanatory chrome. Ask has a
clear question heading. One-speaker summaries omit the redundant word-share chart.
Save errors remain visible from every meeting tab, with a regression test covering
a failed close from Summary. Native Meetings, Summary, and Ask were inspected in
the freshly installed debug build using agent-desktop. The scoped suite now passes
67 frontend tests. Earlier broader-suite counts below are historical, not a fresh
full-regression result.

## Delivered surfaces

- **Meetings** lists ended captures, recording links, portable Meeting Markdown,
  saved editable turns/names and the reviewed Source used for outcome proposals.
- **Save & close** persists transcript review without publishing knowledge.
  Reopening restores edited turns. Editing reviewed content clears its active
  reviewed-transcript link and returns the meeting to `needs-review`; the previous
  evidence file remains preserved. Unchanged reviewed content retains its state.
- **All approved** enumerates accepted claims from applied journal proposals,
  including existing-page additions. Rejected/undone proposals are excluded.
  Source version changes are labelled; this is not semantic currentness detection.
- **Briefs** generates, saves and reopens portable Markdown with source links and
  exact quote evidence. New saves validate the applied proposal, accepted quote,
  page and reviewed source hash, including changes elsewhere in the same source.
  UUID/fingerprint retries return the same saved brief; external edits are refused.

Review uses one outcome-review component. Saving evidence continues if optional
voice enrolment fails or skips short voices. Approval time is now recorded when
apply begins; legacy records with no timestamp return unknown rather than the
proposal creation time.

## Meeting surfaces redesign (later on 1 November 2026)

The same durable records now have five views. Patterns, rules and licensing notes are
in [UI-PATTERNS.md](UI-PATTERNS.md).

- **Memory hub**: Meetings, Search, Ask, Approved and Briefs in one dialog.
  Search matches words by prefix across saved meeting lines (lines from meetings
  whose transcript is not yet reviewed carry a Draft chip) and approved claims. A
  line needs at least half the query words; results are capped at 40 lines and
  20 claims. It does not match by meaning. Ask keeps its thread while the dialog is
  open, can be scoped to one meeting's reviewed source (up to 50 paths), and its
  citations carry the meeting and approximate time so a click seeks the audio.
- **Meeting window**: Transcript, Summary and Ask. Summary is built from approved
  outcomes: a computed count sentence, outcomes by type with exact quote and
  timestamp, key moments, and each speaker's share of words. Moments marked while
  recording are saved with the meeting (at most 200; finite, non-negative times;
  labels up to 120 characters).
- **HUD**: real preparation steps, a level meter from the microphone, a Record view
  with Mark moment (**M**), Pause and End meeting. Timer and marks exclude paused time.
- **Engine** (`engine.py`, `workspace_product`): `meetings`, `summary`,
  `save_meeting`, `meeting_record`, `approved`, `search`, `save_brief` and `briefs`.
  Meeting Markdown lines are `[m:ss] Speaker: text`; timestamps are approximate. A
  meeting's status is derived from its `transcriptPath` on read and write.

## Native observations

Installed app: `~/Applications/Memoria Workspace.app`, `my.memoria.workspace`.
Disposable vault: `~/Memoria-Native-Test/vault-p3`. Observations 1-10 were made
earlier through Open Computer Use (screenshots and AX trees). The redesign
observations after them used `agent-desktop` window screenshots and coordinate
clicks; the web view is not exposed to accessibility, so nothing could be typed.

1. Empty Meetings confirmed. On initial inspection speech/embed workers were
   stopped; restarting the app restored all-three-ready status.
2. Start waited in **Preparing MOSS · not recording** before becoming Recording.
3. A 58-second microphone capture ended, saved its original Source and permanent
   meeting `cbd14c91-706d-4fdc-9cbd-50f8efda6767`, and opened review.
4. Speaker playback of a synthetic sentence did **not** produce an accurate draft:
   only “This is a big one.” was accepted. A clearly labelled fictional manual
   review fixture was entered to exercise persistence. This is not an ASR success.
5. Save & close → Meetings showed one record. Reopening restored the manual edits.
   After app restart the record and reviewed transcript remained available.
6. Publishing reviewed text opened outcome build. Early real-model attempts copied
   unrelated Harbour facts from destination context; exact quotations rejected
   them. The compiler now supplies destination path/title/type only, excludes raw
   Sources and explicitly limits extraction to the current evidence. One bounded
   quotation-repair retry retains exact validation.
7. The revised engine using the app-owned Qwen produced three Cedar-only claims.
   This diagnostic proposal was created through the engine against the disposable
   vault, then loaded and explicitly approved through the native review UI.
   Meetings showed **Outcomes approved** and All approved grew to 12 claims.
8. Initial brief attempt returned unreadable JSON; a diagnostic attempt also mixed
   unrelated Harbour evidence. Full six-heading JSON scaffolding, a neutral model
   system prompt and explicit `Project <name>` source scoping fixed this fixture.
9. Native Create brief produced Cedar-only context, checklist commitment and next
   meeting review, with empty unsupported sections. Save cited brief created
   `briefs/brief-090f272a-f0c7-41e3-9f10-571a5ea2c4f2.md`. Open saved brief rendered
   the document in a native note window with R1/R2/R3 links and quote evidence.
10. Quit/relaunch restored the saved brief in the Briefs list (one saved brief).

### Redesign pass (agent-desktop, installed debug app)

11. The sidebar showed Start meeting, Import files, Review knowledge and a MEMORY group
    (Meetings, Search, Ask, All approved, Briefs) with live counts (All approved 12).
12. Search opened with its field focused and no stray focus ring. Meetings listed
    the real record with all three lifecycle steps done; its earlier inconsistent
    legacy status was normalised from `transcriptPath`.
13. Opening that meeting, Summary showed the three approved Cedar outcomes linked to
    0:20, and Transcript loaded the real 0:58 audio with avatar rows and the player.
14. Defects found natively and fixed: the title field took focus with its text
    selected when a record opened; "Unknown speaker" was clipped in Share of words;
    summary-bar buttons were low contrast. Each was fixed and re-checked in the
    harness (light), and the focus fix has a regression test that fails without it.
15. HUD: with a freshly re-signed build macOS asked for microphone access again, so
    the HUD stayed on the Microphone step and showed the real preparation list.
    Cancel closed it and restored the workspace while the prompt was still pending.
    The first click on the HUD was swallowed (window activation only). Fixed with
    `accept_first_mouse(true)`. A "Waiting for microphone permission..." line now
    appears after 4 s on that step.
16. One approved item from the earlier real-model run was typed Person although it is a
    commitment ("Maya's Checklist Delivery"). That is extraction-prompt quality; this
    pass does not address it.

Found and fixed away from the native app (harness at 480 px, tests): the hub tab strip ran
under the close button at the 480 px window minimum (it now scrolls and keeps the selected
tab in view); the Ask composer squeezed its field at narrow widths (now a container query,
with the Answer/Brief switch on its own row); footers read "1 meetings" and "1 saved
briefs" (now `plural()`); and the sidebar crash above. These were built into the bundle
but have not been installed or seen natively.

**Not yet seen natively on the final build:** the first-click fix and the waiting
hint, the HUD Record view, marking moments, End into review with marks, the
Approved, Briefs and Ask tab layouts, dark mode, Summary to Create brief seeding Ask,
and the Ask composer in the narrow side panel. Search and Ask results were checked
only in the harness, unit tests and engine tests.

## Checks and limits

66 focused frontend tests (14 files) and 30 engine/product tests pass. `tsc -b`, ESLint with
zero warnings on the touched files and `git diff --check` are clean, and the debug app
builds. The full frontend suite still has 97 failing tests in 20 files (6,326 pass), the
same count as before the redesign, so it is not a regression gate: 67 are upstream-chrome
expectations in 13 `src/components` files and 30 are in the updater, wikilink-colour and
`App.*` git/note-window suites. They are untriaged. The run did catch one regression from
this work (the sidebar crashed when the model-status call returned nothing, failing two
`App` suites); it is fixed and covered by `WorkspaceActions.test.tsx`.

The explicit project scope is a single-name heuristic, not general entity
resolution. Related-page selection still uses complete destination text internally,
but model extraction only sees its identity fields; destination hashes still gate
apply. Multiword names, generic topics and temporal supersession need evaluation.

New meeting records begin at End. Legacy captures are not backfilled. Mid-recording
crash recovery, a full two-meeting native demonstration, long native capture,
speaker accuracy and standalone runtime packaging remain acceptance gaps.
Exact quotes establish provenance, not truth or entailment.
