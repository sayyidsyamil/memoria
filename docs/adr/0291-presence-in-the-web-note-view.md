---
type: ADR
id: "0291"
title: "Presence in the web note view: device names, paced awareness, clear within 5 s"
status: active
date: 2026-10-25
---

## Context

The S4 spike (`apps/web/collab.html`) showed avatars and named carets over Yjs awareness, with a name typed into its connect form. Since TOL-190 the shell's editor is bound to the note's live document, but it announced every window as "User" and drew no avatars. TOL-17 (plan row B5-1) asks for avatars and named carets in the shell's note view, readable on an iPhone, with no information only on hover, and for a window that closes its tab, switches note or goes offline to disappear from the others within 5 s, without slowing note open or typing. The server has one bearer token and no accounts, and it already relays awareness and withdraws a client's state when its socket closes. An offline window is the hard case: its socket can stay open on the server for much longer than 5 s, and y-protocols drops a silent peer only after 30 s.

## Decision

**Each window is named after its browser and device. Presence stays on the existing awareness channel with an unchanged payload; the web client throttles what it sends and runs a short heartbeat, and drops peers that stop renewing. The protocol stays at 1.5.**

- **Identity.** With one token, the people in a note are mostly the owner's own devices, so a window announces `"<browser> · <device>"` (`Safari · iPhone`, `Chrome · Mac`), product names that need no translation, from `src/lib/presenceIdentity.ts`. Its colour comes from the document's client id, so two windows on the same device differ. A typed display name, or a server-side identity once accounts exist, can replace the name later without a wire change.
- **Pacing.** `CollabProvider` takes two opt-in options (`packages/collab-client/src/awarenessPacing.ts`): `awarenessThrottleMs` sends the first awareness change at once and the rest together once per interval (a caret moves with every keystroke); `presenceTimeoutMs` renews the own state three times per timeout and removes, locally, the others not renewed within it. The web backend uses 100 ms and 3.5 s, so a silent peer is gone within about 4.7 s. The server, the spike page's defaults and the benchmarks are unchanged. A renewal changes nothing in the state, so it does not reopen a caret's label. Leaving flushes the withdrawal at once.
- **Offline.** On the browser's `offline` event the shell sets its own awareness state to null (`useLocalPresence`): the withdrawal reaches the others when the socket still works, and the heartbeat drops the window when it does not. Back online it announces itself again.
- **Avatars.** `NotePresence` renders the others' avatars (initials on the palette colour, at most three and a count) in the breadcrumb bar's actions while the active note has a live document and someone else is in it. A tap opens a `Popover` listing everyone by name, the viewer first, so no name is behind a hover. The desktop never has a live document, so it renders nothing.
- **Carets.** BlockNote draws the remote carets with `showCursorLabels: "activity"`: a name shows while its person types or moves, then folds back to the caret, so it does not keep covering the line above. `renderCollabCursor` keeps BlockNote's classes and caps the name to 9rem with an ellipsis.
- **Peer input.** Receivers take a peer's colour only when it is `#rrggbb` and cut its name to 64 characters; the provider ignores non-binary frames and reconnects on a frame that does not decode.

## Consequences

- Two windows on one note see each other within a moment of opening, and a window that leaves is gone within 5 s in all three ways; `apps/web/tests/note-presence.spec.ts` checks this in every browser project.
- Each open note sends one small awareness message per client about every 1.2 s while it is open. A background tab whose timers the browser throttles may drop out of the others' list until it renews.
- A peer dropped by the heartbeat comes back one renewal later than it otherwise would, because y-protocols ignores the renewal that carries the clock of the removal.
- Names are not chosen by people yet; two devices of the same kind are told apart by colour only.
