---
type: ADR
id: "0288"
title: "Web touch input: long-press menus and 44 px touch targets"
status: active
date: 2026-10-24
---

## Context

On phones and iPads the web build still behaved like the desktop under a mouse. Note, type, view and folder actions open from right-click menus, which a finger cannot reach: iOS Safari sends no `contextmenu` for a long press, and Android Chrome sends one but follows it with text selection. Icon buttons in the note list header and the sidebar measure 14 to 24 px, below the 44 px that Apple and Google ask for. The empty editor advertised keyboard chords. TOL-24 asks for long-press menus, 44 px targets and a touch-first empty state, reusing Memoria's components and leaving the desktop app and a mouse-driven browser unchanged. The mobile product rules still apply: the shell opens at once from the cache, and nothing may delay the first paint.

## Decision

**When the primary pointer of the web build is coarse, `<html>` carries `data-touch-input`, set before the first render. One document-level gesture turns a touch long press in the sidebar or the note list into a `contextmenu` event at the finger, so every existing menu opens unchanged. `App.css` sizes key targets to 44 px from the attribute. The empty editor offers search and a new note as buttons.**

- **Installation.** `installTouchInput` in `src/lib/touchInput.ts` is called from `main.tsx` for the web build only, before the root renders. It follows `(pointer: coarse)` with `matchMedia` and installs capture-phase pointer listeners on `window`. No component changes, and `App.tsx` does not change.
- **Long press.** A primary touch pointer held 500 ms within 10 px, in `.app__sidebar` or `.app__note-list` and outside text fields, dispatches a bubbling `contextmenu` at the finger's position. React's `onContextMenu` handlers open their menus as they do for a right click. After the menu opens, the click and the compatibility mouse events of the lifted finger on the pressed element are swallowed for 400 ms, so the note under the finger does not open, while a tap beside the menu still closes it. If the browser sends its own long-press `contextmenu` first (Android), the timer stands down, and a later native one is suppressed, so the menu opens once. Mouse and pen keep the right click. Long presses in the editor are left to the browser: text selection and the system callout.
- **Targets.** Under `data-touch-input`, note list buttons, popover triggers and the sort control, the sidebar's icon buttons and rows, the phone back button and context menu items are at least 44 px. Plain `min-width` and `min-height` rules suffice, because `min-height` outranks a forced height. The note list header's action and expand buttons force `!min-w-0`; they add `TOUCH_TARGET_CLASSNAME`, a Tailwind variant that applies only under the attribute, instead of an `!important` rule in `App.css`. The sidebar's icon buttons take their width from a 44 px flex basis, which their forced `!w-auto` does not override. The note list header drops its icon gaps, which the larger hit areas now provide, and the macOS traffic-light inset falls to the 16 px edge margin, because a browser has no window buttons to clear.
- **Empty state.** `EditorLayout` shows `TouchEmptyState`, "Tap a note to start editing" with "Search notes" and "Create new note" buttons, when `useTouchInput` is true. The buttons are 44 px tall and dispatch the quick-open and new-note app commands.
- **Analytics.** `web_touch_long_press_menu_opened` (`surface`: `sidebar` or `note_list`) and `web_touch_empty_state_action` (`action`: `search` or `new_note`). Telemetry loads lazily from the gesture, so the startup chunk does not grow.

## Alternatives considered

- **A `useLongPress` hook in every list row** (`NoteItem`, sidebar rows, folder rows, views): four shared components would change, including the desktop's, and each new menu would need the hook again.
- **Radix `ContextMenu`**: it has a long press, but every custom menu would have to be rewritten, and the desktop's menus would change.
- **Width breakpoints instead of `pointer: coarse`**: a narrow desktop window would get 44 px targets and a touch laptop at desktop width would not.
- **Invisible enlarged hit areas (`::after`)**: the visual stays smaller, but neighbouring hit areas overlap in the crowded list header and tests cannot measure them.

## Consequences

- Every menu that opens on right click in the sidebar or note list now opens with a long press on phones and tablets, including future ones.
- The note list header on an iPad in portrait has room for the title's first letter only, as before; the controls no longer overlap.
- The status bar and the editor's toolbars keep their desktop sizes; the status bar is due to be replaced by a sync status on the web (`docs/web/ui-departures.md`).
- The gesture is tested with dispatched touch pointer events in WebKit iPhone and iPad emulation; a real device should confirm the 500 ms timing against iOS's own callout.
