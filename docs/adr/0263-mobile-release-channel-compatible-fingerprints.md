# ADR-0263: Mobile Release-Channel Compatible Fingerprints

Platform: mobile

Date: 2026-10-19. Status: accepted.

Complements ADR 0247. Its exact-artifact promotion and native acceptance rules
remain unchanged.

## Context

Clean SDK 57 fingerprint resolution produced different Alpha and Stable runtime
hashes despite identical native inputs. The only differing source was the
`expo-channel-name` request header. Build numbers also change for successive
TestFlight uploads without changing native compatibility. Consequently a tested
Alpha artifact could not be republished unchanged to a compatible Stable binary.

## Decision

Keep Expo's fingerprint runtime policy. Use its supported `fileHookTransform`
to remove only the Alpha or Stable channel header from the `expoConfig` hash
input. Leave the actual app configuration and embedded channel unchanged.
Preserve every other request header, update origin, recovery setting, native
permission, platform identity, dependency and custom module in the hash.
Unknown channels and the isolated validation channel remain distinct.

Use Expo's `ExpoConfigVersions` skip for application/build version metadata,
retaining its default package-script skip. No native source, dependency or
configuration category is broadly ignored. Invalid or incomplete configuration
must fail fingerprint resolution rather than produce a fallback runtime.

## Verification

Resolve real Alpha and Stable managed iOS runtimes with different build numbers
and verify equality. Mutating a native permission or update origin must change
the runtime; native dependencies and sources retain Expo's normal hashing.
The transform must not mutate the app configuration. Rebuild and accept native
OTA delivery after this runtime change; previous runtime acceptance is not proof
for the new fingerprint. Do not republish any update without matching accepted
native-runtime evidence.

## References

- [Expo fingerprint configuration](https://docs.expo.dev/versions/v57.0.0/sdk/fingerprint/)
- [Exact-artifact promotion](0247-automatic-alpha-manual-stable-mobile-ota.md)
