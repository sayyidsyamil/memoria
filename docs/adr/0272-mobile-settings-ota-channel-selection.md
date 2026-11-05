# ADR-0272: Mobile Settings OTA Channel Selection

Platform: mobile

Date: 2026-10-21. Status: accepted.

Supersedes only the separate-TestFlight-group recommendation in ADR 0247.
Automatic main-to-Alpha publication, manual exact-artifact Stable promotion,
runtime compatibility and release/security gates remain unchanged.

## Decision

Distribute one native binary through the external Memoria Beta TestFlight group.
Settings selects Stable or Alpha; fresh and legacy preferences default to Stable.
The selected preference is distinct from the channel/update currently running.
Existing Alpha-native binaries receive this selector through a compatible OTA;
their first embedded/older launch can still be Alpha before the preference loads.

Use Expo's `setUpdateRequestHeadersOverride` for the existing
`expo-channel-name` header only. Keep the update origin, native runtime matching,
and anti-bricking measures unchanged. Do not use the URL-override API or arbitrary
channel names. Preserve the selection in the existing recoverable settings file,
outside vault data, and reapply its header after settings load.

Selecting a channel saves the preference, checks and downloads its compatible
update. Downloading never forces a restart. Explicit restart first freezes and
flushes active editors and drains the workspace write queue. Save failure prevents
reload and restores editing. A missing update, rejected rollback, failed download,
or offline request must not be reported as a ready update.

Channel selection never changes vault formats or data. Alpha and Stable releases
must retain compatible on-disk formats; incompatible migrations require a separate
native/runtime boundary or an explicit one-way migration design.

## Verification

Tests cover Stable defaults, Alpha persistence, malformed channels, safe restart
ordering, save failures, offline retry, missing updates, failed downloads,
concurrent requests, and disabled developer builds. Production native acceptance
must verify persisted header switching and actual downloaded update identity;
JavaScript mocks alone are not evidence of remote delivery.

## References

- [Expo channel surfing](https://docs.expo.dev/eas-update/channel-surfing/)
- [Automatic Alpha and manual Stable](0247-automatic-alpha-manual-stable-mobile-ota.md)
- [Compatible native fingerprints](0263-mobile-release-channel-compatible-fingerprints.md)
