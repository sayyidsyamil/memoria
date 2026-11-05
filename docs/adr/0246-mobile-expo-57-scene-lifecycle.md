# ADR-0246: Supported Mobile Scene Lifecycle

Platform: mobile

## Status

Accepted. Supersedes ADR-0250's temporary Expo SDK 54 preview pin.

## Context

The current Xcode 27 build aborts before JavaScript starts on iOS and iPadOS 27
because the SDK 54 app uses the application lifecycle instead of UIScene. This
was reproduced with the ordinary Release binary on both disposable simulators.
The Expo Go 54 compatibility constraint that motivated ADR-0250 no longer
defines the distribution target.

## Decision

Use stable Expo SDK 57 with its supported scene backport, available from Expo
57.0.23. Enable `ios.enableSceneSupport` through `expo-build-properties` in the
tracked dynamic app configuration. Generate native projects through prebuild;
do not maintain a private UIKit opt-out or an SDK 54 scene adapter.

Align React Native, Metro, Worklets, Reanimated and Expo modules with the SDK 57
compatibility set. Align the existing Sentry React Native/core and Cocoa/SwiftPM
dependency versions without changing the consent or redaction architecture.
Keep unrelated workspace dependencies and editor patches intact.

Use Expo's scene delegate and existing module subscribers for window creation,
link delivery and lifecycle forwarding. The existing keyboard root-controller
handler remains the integration boundary; do not add another window owner.
Require native startup, linking, focus, recovery and background-writeback
acceptance on iPhone and iPad, including the newer OS runtime. A config unit test
alone does not prove that the generated app launches correctly.

## Consequences

- Native builds require the SDK 57 minimum iOS version, 16.4; do not force the
  previous 15.1 build override into the new project.
- The native dependency/lifecycle change requires a new signed binary and OTA
  fingerprint. Older OTA acceptance is not proof for this runtime.
- Development and distribution identities remain separate. Prebuild and QA must
  not reset, migrate or overwrite existing user vaults.
- Release analysis, dependency-security, coverage, telemetry and native gates
  remain required; upgrading is not a waiver for outstanding findings.

## References

- [Expo scene lifecycle and SDK 57 opt-in](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md)
- [Expo build-properties](https://docs.expo.dev/versions/v57.0.0/sdk/build-properties/)
