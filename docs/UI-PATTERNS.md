# Memoria UI patterns — 1 November 2026

Why this exists: the meeting surfaces were rebuilt around a **Record / Transcript /
Summary / Ask / Search** model to look like a purpose-built meeting product rather
than generic generated UI. This file records the rules that pass followed, what is
shared, and what has and has not been verified. Earlier passes are in
[UNSLOP-PASS.md](notes/UNSLOP-PASS.md) and [MEETING-UI-PASS.md](notes/MEETING-UI-PASS.md).

## Provenance and licence

The pass was informed by two public references: the Aceternity UI site (its
animated pill-style tabs) and a "Meeting Notes" reference page (Parley) showing
Record, Transcript, Summary, Ask and Search views.

- **No code, markup, CSS, copy, images, icons or fonts were copied** from Aceternity
  UI (Pro or free registry) or from Parley. Their terms restrict redistributing
  source, which cannot be combined with this repository's
  AGPL-3.0-or-later licence. The reference copy lives outside this repository, read-only.
- The free Aceternity *Tabs* registry item needs `motion/react`. Memoria does not
  ship it and **no dependency was added**. The sliding pill is Radix Tabs (already a
  dependency) plus original CSS and a measured offset; it respects
  `prefers-reduced-motion`.
- What was taken is general interface convention, not expression: segmented pill
  tabs, avatar + speaker rows, a large timer over a level display while recording,
  a summary read as a document, citation chips on chat answers.
- Everything here is an original implementation inside Memoria's existing
  component set (Radix, Phosphor icons, project CSS variables).

## Rule: every visual reflects real state

Nothing animates or fills "to look alive". Each element has one source of truth:

| Element | Source | It must not imply |
|---|---|---|
| Level meter (HUD) | RMS of each 4096-sample, 16 kHz PCM block (256 ms), `blockLevel` in `meetingLiveSpeech.ts`; flat while paused | a decorative waveform |
| Preparation steps | live-speech events: microphone granted, speech model loading, warming, captions ready | progress it does not have |
| "Waiting for microphone permission…" | Microphone step still pending after 4 s | that anything is recording |
| Timer and marks | recorded time excluding pauses, equal to the audio file's time | wall-clock time |
| Meeting lifecycle rail | saved state: transcript path, outcome status | an animation |
| Summary lead sentence | counts of approved outcomes, computed | generated prose |
| Share of words | word counts per speaker | talk-time or participation quality |
| Search | keyword and prefix match; the UI says it is not meaning-based | semantic search |
| Draft chip | unreviewed transcript lines | reviewed evidence |
| Timestamps | approximate seek positions | exact offsets |
| Citation chip | title plus `m:ss` or `p.N`; reveals the exact quote | that the quote is true (it proves provenance only) |

Copy follows the same rule: state what is happening or not happening ("Recording
starts when everything is ready", "Speaker labels are provisional"), never a
confidence or accuracy claim.

## Shared kit

The product-wide Unslop follow-up in [UNSLOP-PASS.md](notes/UNSLOP-PASS.md) supersedes
the earlier visual treatment: labels use sentence case, shared controls use 8px
corners inside 12px segmented groups, avatars are neutral, primary chrome is
graphite, and the selected tab moves without bounce or animated width. Evidence
timestamps and semantic feedback retain meaningful accent colour.

`src/components/memoriaUi.tsx` and `memoriaUi.css`:

- `SectionLabel`, `Chip` (tones: neutral, blue, green, orange, red, purple, teal,
  pink; optional dot), `Avatar` (initials, tone, size), `EmptyState`.
- `PillTabsRoot` / `PillTabList` / `PillTabPanel`: Radix Tabs with a sliding pill.
  Radix selects on mouse-down or focus, so `PillTabList` also takes `onSelect` to
  select on click and assistive "press". Count badges and an attention dot are
  supported.
- `LifecycleRail`: ordered steps marked done, current (next) or not started. The
  Meetings list uses Recorded, Transcript reviewed and Outcomes approved, derived
  from the saved record (`transcriptPath`, `outcomesStatus`).
- `StateButton`: one button that reports idle, working and done in place.
- `LevelMeter`: bar display driven by an array of 0–1 levels.
- Tones are set with `data-tone` and the `--tone` CSS variable, so colour is chosen
  by state or speaker order and never by hand per component.
- Non-component helpers live in `src/lib/{speakers,hud,knowledgeKinds,format}.ts` and
  `src/hooks/useWorkspaceSummary.ts` (the lint rules forbid mixing them into
  component files).

## Surfaces

- **Sidebar** (`WorkspaceActions.tsx`): Start meeting is the one primary action.
  Import files and Review knowledge are quiet rows. MEMORY lists Meetings, Search,
  Ask, All approved and Briefs with live counts; an orange count means a source
  changed after approval. Counts refresh on a `summary` action, an in-app event,
  window focus and a 60 s timer.
- **Memory hub** (`WorkspaceMemoryHub.tsx`): one dialog, five pill tabs: Meetings,
  Search, Ask, Approved, Briefs. Search and Ask stay mounted while hidden, so a
  question thread survives switching tabs. Opening a meeting uses a separate dialog.
- **Meeting window** (`MeetingTranscriptReview.tsx`): editable title; Transcript,
  Summary and Ask tabs; speaker avatars, active-line highlight synced to audio,
  per-turn speaker select; Speakers and Marked moments are collapsible. The audio
  player sits in the footer with mark ticks. Saving the transcript moves to Summary
  and builds outcomes.
- **Summary** (`MeetingSummary.tsx`): locked until the transcript is reviewed;
  inline review while proposals are pending; then a document with outcomes grouped
  by type, a quote disclosure and a timestamp or page chip per outcome, key moments,
  share of words, and Create brief / Review or undo.
- **Meeting HUD** (`MeetingHud.tsx` logic, `MeetingHudView.tsx` presentation): a
  compact dark notch (360 x 68) with a level meter; a preparation list (176 high);
  the Record view (620 x 620) with status, 56-bar level display, avatar live turns,
  Mark moment, Pause and End meeting; review expands to 900 x 740 and follows the
  workspace theme. Recording starts only after the speech model, voice encoder,
  microphone and AudioWorklet are ready.

## Interaction rules

- Dialogs that open on a list or record do not auto-focus their first control
  (`onOpenAutoFocus` is prevented), so no stray focus ring or selected title appears.
  Search and Ask focus their field only when their tab becomes active.
- The HUD accepts the first click (`accept_first_mouse`) because it is used while
  another app is in front; without it every button needed two clicks.
- Mark moment is the **M** key or the button. It is not Cmd+M, which macOS uses to
  minimise.
- Focus rings use `--ring`; tab rings are inset so they are not clipped.
- Responsive rules follow the container, not the viewport. A pill tab strip shrinks and
  scrolls sideways (scrollbar hidden, tabs stay focusable) and keeps the selected tab in
  view; at the 480 px window minimum the hub's five tabs no longer run under the close
  button. The Ask composer is a container query: below 460 px the Answer/Brief switch
  moves to its own row instead of being hidden or squeezing the field.
- Counts are written with `plural()` so the footer never says "1 meetings".
- Status text uses `role="status"` or `aria-live`; decorative icons are
  `aria-hidden`; motion is off under `prefers-reduced-motion`.
- Keep text on `--foreground` / `--muted-foreground`; do not rely on a muted button
  colour on a muted background (this was a real contrast defect on the summary bar).

## Verification and limits

Run on 1 November 2026:

- 66 focused frontend tests in 14 files (meeting surfaces, sidebar, shared kit and the
  Quiet UI guard), 30 Python engine and product tests, `tsc -b` and ESLint with zero
  warnings on the touched files. Two regression tests were mutation-checked (they fail
  without their fix): the hub dialog not stealing focus, and the sidebar surviving an
  empty model-status response.
- Light and dark screenshots of the hub (Meetings, Search, Ask, Approved), the meeting
  Transcript and Summary tabs and the three HUD states, from a throwaway Vite harness
  that mounted the real components against a mocked Tauri bridge. The harness is
  not committed.
- Native, on the installed debug app and a disposable vault, using `agent-desktop`
  window screenshots and coordinate clicks: the sidebar, Meetings list, Search tab
  opening with focus, a saved meeting's Summary and Transcript tabs with real
  audio loaded, and the HUD preparation state and cancel path.

Not verified natively on the final build: the HUD Record view, marking moments and
End into review; the Approved, Briefs and Ask tab layouts; dark mode; Summary to
Create brief seeding Ask. The narrow-container layouts (Ask composer, scrolling tab
strip) were checked in the harness at 480 px and 430 px viewports, not in the real
side panel.
Typing into the native web view is not possible with the tooling used, so Search
and Ask results are covered by the harness, unit tests and engine tests only.
macOS asks for microphone access again after each rebuild because the debug app is
ad-hoc signed, so every native recording test needs that prompt answered by a person.

On 1 November the full frontend suite had 97 failures among 6,424 tests in 20 files, the same
count as before this pass. Thirteen files in `src/components` (67 tests) asserted upstream chrome
that the quiet-UI pass removed or renamed: the community banner, Discord button, git status-bar
test ids and the `FAVORITES` / `FOLDERS` labels. Seven more files (30 tests: the updater,
wikilink accent colours, and `App.*` git, sync and note-window cases) failed on missing
status-bar ids, a disabled updater and vault-loader call counts, none of which touch the meeting
surfaces. All were resolved on 2 November ([M3-FULL-SUITE-TRIAGE.md](M3-FULL-SUITE-TRIAGE.md)).
The full run did catch one regression from this work, a sidebar crash when the model-status call
returns nothing; it is fixed and covered by `WorkspaceActions.test.tsx`.

Speech accuracy, long sessions, sleep and device changes, crash recovery of raw
audio, model eviction and packaging are separate acceptance gaps and are not
addressed by this pass.
