# ADR 0231: Mobile modal keyboard dismissal

Platform: mobile
Status: Accepted
Date: 2026-10-17

## Context

Mobile workspace sheets, native Settings/vault modals and editor link dialogs
have independent lifetimes. Escape was special-cased for the command palette,
leaving other dialogs open. Multiple independent Escape listeners could instead
dismiss both a child dialog and its parent from one key press.

## Decision

Register visible dialogs with one mobile dismissal stack. Escape invokes only
the topmost registered Cancel/Close callback; it never saves a form or bypasses
an existing busy-operation guard. Cleanup removes that specific registration,
and rerenders update its callback without moving it above a newer dialog.

Use one keyboard subscription while any dialog is registered. Deduplicate a
bubbling browser event and ignore modified/repeated Escape events. Keep native
modal eligibility separate from command-palette arrow navigation, so a form does
not make the note list consume cursor keys. Native Escape dispatch uses the
existing MemoriaKeyCommands bridge, not a synthetic editor command.

## Consequences

Dialog components opt in through a small hook and retain their existing Cancel
semantics. Future dialogs must register for their visible lifetime. Tests cover
stack ordering, stale callbacks, out-of-order cleanup and native keyboard input
on both iPhone and iPad. Browser-only dismissal is not native acceptance.
