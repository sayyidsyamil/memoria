# ADR-0250: Expo SDK 54 for iPad Expo Go Preview

## Status

Accepted

## Context

The mobile UI foundation needs fast, faithful review on a physical iPad. The current iPad can run Expo Go 54, while the local Xcode/device toolchain is not ready for a physical development build. Keeping the prototype on Expo SDK 56 blocks that feedback loop because Expo Go rejects projects built for a newer SDK.

Expo SDK 54 uses React Native 0.81 and React 19.1, which is sufficient for the current fixture-driven UI lab and React Native Reusables/Nativewind work.

## Decision

Pin `apps/mobile` to Expo SDK 54-compatible package versions while the mobile UI foundation is reviewed through Expo Go on iPad.

Use `expo start` / `expo start --ios` for device preview during this phase. Keep generated native `ios/` and `android/` projects out of the committed source unless Memoria explicitly moves to a checked-in development-build workflow.

## Consequences

- Physical iPad review can use Expo Go without requiring the Mac's Xcode/device-signing setup to be upgraded first.
- Mobile UI work stays fast and close enough to native runtime behavior for layout, scrolling, touch, and gesture feedback.
- New mobile dependencies must remain SDK 54-compatible until this ADR is superseded.
- Before production mobile work or store builds, Memoria should re-evaluate the SDK pin and upgrade through Expo's supported path.
