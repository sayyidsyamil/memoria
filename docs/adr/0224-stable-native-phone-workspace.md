# Stable native phone workspace

Date: 2026-10-14. Status: accepted.

## Context

Window-width breakpoints can turn a landscape phone into a tablet and remount its
workspace. Keyed screen transitions also discarded editor mode, selection and
list scroll position whenever a user opened Properties or returned to the list.

## Decision

Use the native device class for iOS and the screen's shorter dimension for
Android (600 points). Browser previews retain the 900-pixel workspace breakpoint.
Keyboard-reduced window height must not change the native device class.

Phone navigation retains the visited note list and editor, with inactive layers
excluded from input and accessibility. Navigation blurs the editor. Explicit
note changes still replace the note-scoped editor as before. Sidebar and
Properties remain disposable views. Animate the containing layer without using
screen identity as a React key; honor the system Reduced Motion preference.

Use existing desktop-derived tokens and RNR controls. Phone property forms omit
locked definition controls and pin Save outside the scrolling field area.
Compact formatting is independent of phone orientation. Tablet controls and
their shared command semantics are unchanged.

## Consequences

The retained editor consumes memory after its first visit, but avoids a WebView
reload on every inspector visit. It is still destroyed with the workspace.
Native regression tests must cover source-mode return, software-keyboard Save
clearance, rotation, and the corresponding iPad forms and gestures. Browser
screenshots do not establish these results.
