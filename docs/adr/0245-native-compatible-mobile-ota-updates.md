# ADR-0245: Native-Compatible Mobile OTA Updates

Platform: mobile

Date: 2026-10-18. Status: proposed; native acceptance tracked in TOL-96.

## Context

Mobile beta fixes need a delivery path independent of another store upload.
Downloading JavaScript must not delay local-vault startup, interrupt editing or
allow code requiring a different native module set to run. Existing app data must
survive update, rollback and a failed download.

## Decision

Use the SDK-compatible `expo-updates` client and the existing EAS Update project
`refactoring/memoria-mobile`. Keep CircleCI as the publishing orchestrator. Desktop
changes do not implicitly publish mobile updates.

Use alpha for TestFlight, stable for the store profile, and an isolated
ota-validation channel and application identity for native acceptance. Ordinary
development builds disable remote updates. Validate profile/channel agreement
instead of silently falling back to a production channel.

Use Expo's fingerprint runtime policy, not an application version as a proxy for
native compatibility. A changed native dependency, custom module or configuration
requires a new native binary. Continue generating native projects through Expo
prebuild; do not maintain a separate hand-written update launcher.

Check and download on launch with zero launch wait and an embedded bundle. Apply
downloaded updates at a subsequent cold launch. Do not call `reloadAsync` from an
editing session. Keep Expo's anti-bricking and error-recovery protections enabled.
These protections do not substitute for testing or protect against incompatible
vault migrations; OTA changes must retain backward-compatible persistence.

Attach only allowlisted channel, runtime fingerprint, update UUID and launch
source to the existing consent-governed telemetry context. Do not send manifests,
vault identifiers or raw recovery-error text. An isolated-channel local proof log
supports native acceptance without enabling analytics or modifying user vaults.

## Acceptance

Before distribution, demonstrate a real EAS download and subsequent launch on
native iPhone and iPad Release builds without reinstalling. Verify preserved owned
fixture data, embedded/offline launch, incompatible-runtime rejection and rollback.
Verify source-map attribution for the actual published artifact. Android needs its
own accepted native build; iOS evidence does not establish Android support.

The owner authorized continuing OTA implementation despite the three recorded
unpatched dependency advisories. Keep them visible in TOL-97; no suppression or
claim of a clean dependency scan follows from that direction.

## References

- [Expo runtime compatibility](https://docs.expo.dev/eas-update/runtime-versions/)
- [Expo update error recovery](https://docs.expo.dev/eas-update/error-recovery/)
- [Expo rollback procedures](https://docs.expo.dev/eas-update/rollbacks/)
