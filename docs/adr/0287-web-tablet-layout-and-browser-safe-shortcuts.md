---
type: ADR
id: "0287"
title: "Web tablet layout and browser-safe shortcuts"
status: active
date: 2026-10-24
---

## Context

On an iPad the web build showed the desktop's three panes. In portrait (834 px) the editor started at x = 566 and was clipped on the right (`docs/web/s1-tauri-inventory.md`); in landscape the three panes fit but left the note narrow. TOL-194 asks for two panes, the note list and the note, with a collapsible sidebar, in both orientations, and for hardware-keyboard shortcuts that do not clash with the browser. The phone stack (ADR 0286), desktop-width web and the desktop app must not change, and the mobile product rules apply: open instantly, a tap focuses the editor, no freezes.

The desktop shortcuts are native menu accelerators. In a browser several belong to the browser and never reach the page (⌘N new window, ⌘1–9 tabs, ⌘⇧T reopen tab), others would take away a familiar browser action (⌘P print, ⌘D bookmark, ⌘± page zoom, ⌘, Safari settings), and the empty editor advertised `⌘P / ⌘O / ⌘N`.

## Decision

**A tablet is the web build at `(min-width: 641px) and (max-width: 1366px) and (pointer: coarse)`. There the sidebar starts collapsed and its open state lasts for the session; in portrait it floats over the note list. The web build leaves browser-owned shortcuts to the browser and moves the most used commands to ⌥⌘ (Ctrl+Alt off Apple keyboards).**

- **Scope.** `useTabletSidebar`, called from `useAppWindowControls` for the main window of the web build, narrows the view mode's `sidebarVisible` with a session flag that starts closed. Choosing a view mode opens the sidebar (`all`) or closes it; the sidebar's collapse control closes it without writing `view_mode`, which the vault shares with the desktop. The touch condition keeps a desktop browser of the same width on the desktop layout. `App.tsx` does not change.
- **Panes.** `useTabletSidebar` marks `<html>` with `data-tablet-layout` in a layout effect, before the first paint. `App.css` drops the editor's 480 px minimum there, sets the note list header's traffic-light inset to the normal 16 px, and in portrait positions the sidebar over the list with a shadow and no resize handle. A tap inside the shell beside the floating sidebar closes it; taps in menus and dialogs, which render outside the shell, do not.
- **Shortcuts.** `findShortcutCommandIdForEvent` and `getAppCommandShortcutDisplay` consult `webShortcuts` in the web build: the browser-owned desktop shortcuts match nothing and show no hint, and ⌥⌘N (new note), ⌥⌘P (quick open) and ⌥⌘1/2/3 (editor only, editor and list, all panes) are matched by key position, because ⌥ changes the character. Off Apple keyboards the chord is Ctrl+Alt, except when the key is AltGr, which types characters. ⌘K, ⌘S, ⌘Z, ⌘F, ⌘⇧F, ⌘\ and the rest keep their desktop chords. Everything else stays in the command palette.
- **Arrow keys.** No shortcut handles a bare arrow key, so a held arrow is the editor's own. A web e2e holds ArrowDown for twenty repeats in the tablet and desktop projects and requires every repeat to move the caret and the median handling time to stay under one 30 Hz repeat interval.

## Alternatives considered

- **Width only** (`max-width: 1366px`): would collapse the sidebar of every laptop browser window, against the unchanged desktop-width layout.
- **Persist the collapsed sidebar in `view_mode`**: the desktop would open with its sidebar hidden after a session on the iPad.
- **Push the panes in portrait as well**: sidebar, list and note do not fit 834 px; the note would be clipped again.
- **⌃⌥ chords**: VoiceOver's modifier on macOS and iPadOS.
- **⌘⇧ chords**: ⌘⇧N and ⌘⇧T belong to the browser as well.

## Consequences

- Portrait and landscape iPads open with the note list and the note side by side; the sidebar is one tap or ⌥⌘3 away.
- A tap beside the portrait sidebar both closes it and acts on what was tapped, so tapping a note opens it.
- On every web layout ⌘N, ⌘P, ⌘1–3, zoom, ⌘D, ⌘E and the ⌘⇧ chords of the properties, AI and outline panels are left to the browser; those panels open from the command palette or their buttons.
- The ⌥⌘ chords avoid the Safari, Chrome and iPadOS shortcuts known when this was written; they are tested in emulation only, and a real iPad with a hardware keyboard should confirm them.
