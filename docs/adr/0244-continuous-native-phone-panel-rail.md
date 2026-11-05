# ADR-0244: Continuous Native Phone Panel Rail

Platform: mobile

Date: 2026-10-18. Status: accepted.

Supersedes ADR-0224's disposable sidebar/inspector lifetime and transition
implementation. Its device-class selection, note-scoped editor lifetime and
keyboard conventions remain in force.

## Context

The phone drag preview duplicated workspace surfaces. A committed gesture then
reset its relative offset while a separate route transition could animate the
destination again. Transient panes and preview editor content made panel entry
appear to flash or reload. Full window dimensions also exceeded the actual
landscape content width inside the app's horizontal safe area.

## Decision

Place the actual sidebar, list, editor and inspector in fixed slots on one rail.
Use the existing React Native Gesture Handler and Reanimated dependencies for
native intent recognition, dragging and timing. Update the offset on the UI
thread; notify React only after a successful settlement. Do not render a second
editor or preview copy of a panel.

Keep lightweight panes ready for entry and retain the single editor after its
first visit. Inactive content remains painted but cannot receive input or appear
in accessibility navigation. Selecting another note still changes the
note-scoped editor as before.

Use absolute pane positions throughout a gesture. A new drag starts from the
presented offset and cancels older animation completion through an epoch.
Cancellation returns to the nearest origin without committing stale navigation.
Use bounded timing rather than a spring and honor Reduced Motion. Button
navigation uses the same rail, while browser previews retain pointer responders.

Compute usable width after the outer horizontal safe area exactly once. Panel
frames, rail bounds and edge recognition all use that same local coordinate
space. Preserve vertical scrolling and text selection; leftward note-row drags
remain owned by Star/Delete/Archive rather than panel navigation.

## Consequences

The sidebar and inspector retain local UI state instead of remounting on entry.
No new dependency, vault format or persistence mechanism is introduced. The
iPad's independent continuous multi-panel interaction is unchanged.

Native regression tests must cover repeated and cancelled drags, draft/keyboard
continuity, list scroll position, landscape safe areas and trailing row actions.
Browser screenshots alone cannot establish native continuity or frame timing.
