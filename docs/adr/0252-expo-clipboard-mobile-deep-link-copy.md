# ADR-0252: Expo Clipboard for Mobile Deep-Link Copy

## Status

Accepted

## Context

The mobile UI foundation is moving from static parity into real note actions. Desktop Memoria already lets users copy a `memoria://<vault-slug>/<relative-note-path>` URL for the active vault item, and the mobile More Actions sheet exposes the same command label.

React Native does not provide a supported core clipboard API, and browser clipboard behavior is not a faithful proxy for the Expo app on iPad. The mobile app must stay compatible with Expo SDK 54 and Expo Go during this preview phase.

## Decision

Use `expo-clipboard` as the SDK-54-compatible native clipboard adapter for mobile deep-link copy.

The mobile app keeps URL construction and clipboard access outside visual components:

- `mobileDeepLinks.ts` builds desktop-shaped Memoria URLs from `MobileWorkspaceSnapshot.source` and the selected note path.
- `mobileClipboard.ts` writes through Expo Clipboard and records deterministic QA evidence for automated tests.
- `useTabletWorkspaceController` owns the action callback that the More Actions sheet receives.

Incoming mobile deep-link opening and OS URL-scheme registration are not part of this decision.

## Consequences

- Mobile copy-deep-link uses the real Expo/native clipboard path instead of a browser-only fallback.
- Expo Go compatibility is preserved because the dependency is installed through Expo's SDK 54 resolver (`expo-clipboard@~8.0.8`).
- Visual components remain platform-agnostic and easy to screenshot-test.
- Deep-link opening still needs a later platform-registration slice before mobile can receive `memoria://` URLs.
