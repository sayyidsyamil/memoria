---
type: ADR
id: "0286"
title: "Web phone layout as a URL-driven pane stack"
status: active
date: 2026-10-24
---

## Context

At phone width the web build showed the desktop's three panes side by side: the editor sat off-screen at 393 px and could not be reached by touch (`docs/web/ui-departures.md`). TOL-193 asks for a single-pane stack, the note list and then the note, where browser back returns to the list through the TOL-175 URLs (ADR 0284), inside the safe area and with the caret kept above the on-screen keyboard. The mobile product rules apply: open instantly from cache, a tap opens and focuses at once, no freezes on big vaults. Tablet and desktop-width layouts, and the desktop app, must not change.

## Decision

**At `(max-width: 640px)` in the web build, the shell shows one pane, the note list or the note. Which one is part of the route: while the list is shown the URL names no note. The panes stay mounted and are switched by CSS.**

- **Scope.** `usePhoneNoteStack`, called from `useActiveNoteLocation`, is active only when web routing is (web build, main window) and `usePhoneLayout` matches. It marks `<html>` with `data-phone-pane="list|note"` in a layout effect, before the first paint, and every phone rule in `App.css` keys on that attribute, so no other layout sees it. The panes it does not render read it from `phoneNoteStackStore` (`useSyncExternalStore`): `LazyEditor` renders the back bar above the editor and `NoteList` wraps its opener so a tapped note is shown, the open one included. Off the phone the store is inactive, the bar renders nothing and the opener is passed through unchanged; `App.tsx` does not change.
- **Route.** `useWebRouting` takes an optional `noteListPane`. While it is shown, the routed note is `null`. Opening a note from the list pushes the note's URL; a popped URL without a note shows the list instead of keeping the note (wider layouts keep it, as before). Each pushed entry records in `history.state` whether the entry before it named no note, so the in-app back control calls `history.back()` when that is the list and only otherwise shows the list itself (a shared note URL has no list beneath it).
- **Startup.** The list comes first unless the opening URL names a note. The restored last note opens behind the list as on desktop, so tapping it is instant, and the cached-list paint path is unchanged.
- **Panes.** The hidden pane is `visibility: hidden` and absolutely positioned rather than unmounted or `display: none`: the list keeps its scroll position and the editor stays laid out and ready to take focus. The sidebar and resize handles are hidden on the phone.
- **Keyboard and safe area.** `useKeyboardAwareViewport` writes `visualViewport` height and offset to CSS variables (no React state, so nothing re-renders while typing) and, after a resize, scrolls the caret's scroll container until the caret clears the keyboard. The shell is `position: fixed` to that box with `env(safe-area-inset-*)` padding; `index.html` adds `viewport-fit=cover`, which only Safari on iOS reads.

## Alternatives considered

- **A separate phone shell or route**: a second layout to keep in step with the desktop shell, and the deep links would differ between widths.
- **Unmount the hidden pane**: reloads the editor and loses the list position on every back, against the open-instantly rule.
- **Pane state outside the URL**: browser back would walk notes while the screen stayed on a note, and a reload could not tell list from note.
- **`interactive-widget=resizes-content` only**: Chrome on Android honours it, Safari on iOS does not; the `visualViewport` path covers both.

## Consequences

- Browser back and the in-app back control return to the list; forward reopens the note.
- On the phone, back from a note opened through a wikilink goes to that earlier note in the browser, while the in-app control goes to the list.
- Deleting the note on screen opens the next one, as on the desktop. A rename moves the open note to a new path the same way a delete does, so the phone does not try to tell them apart.
- The sidebar (types, saved views, favorites) is not reachable on the phone yet; a later card adds it as a pane before the list.
- iPad layouts (TOL-194) keep the desktop panes until their own card.
