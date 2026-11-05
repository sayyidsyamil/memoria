# ADR-0247: Automatic Alpha and Manual Stable Mobile OTA

Platform: mobile

Date: 2026-10-19. Status: accepted.

Supersedes the delivery-trigger and channel-use portions of ADR 0245; its native
compatibility, launch safety, source-map, data-safety and acceptance rules remain.

## Decision

Every main push enters the normal CircleCI quality workflow. After frontend,
Rust, smoke, performance and mobile checks pass, publish alpha automatically.
Use the push base revision so a multi-commit push includes every changed input.
Skip desktop-only changes without requiring mobile credentials or a native target.
Serialize automatic alpha publication so a slower older pipeline cannot replace a
newer update. Other branches and tags cannot use the automatic publisher.

Stable is never an automatic consequence of main or a desktop release tag. Start
the explicit `publish-mobile-ota` pipeline on main with `mobile-ota-channel=stable`
and an exact `mobile-ota-group` UUID from the tested alpha update. The workflow
requires its quality jobs and an operator approval. Verify that the group contains
an ordinary alpha iOS artifact for the accepted stable runtime, then use EAS
`update:republish --group ... --destination-channel stable --platform ios`.
Do not rebuild from current main or repoint stable at the moving alpha branch.
Source maps already processed for alpha remain associated with the same bytecode
and debug IDs. No new private credentials enter command arguments or logs.

Both OTA channels may have TestFlight builds, assigned to corresponding tester
groups. A build's native channel, not its TestFlight group, controls OTA selection.
Stable can subsequently serve a compatible store build. Republishing preserves
the alpha bundle's compiled environment; actual OTA channel metadata identifies
the destination. Channel-specific behavior must not rely on changing compiled
environment variables during promotion.

## Operational Configuration

The restricted `memoria-release` context supplies publishing credentials plus
`MEMORIA_ACCEPTED_ALPHA_RUNTIME`, `MEMORIA_ACCEPTED_ALPHA_BUILD_NUMBER` and
`MEMORIA_ACCEPTED_STABLE_RUNTIME`. Set these only after the matching native binary
is accepted; never infer acceptance from a successful JavaScript export. Explicit
manual pipeline runtime/build parameters remain available for isolated acceptance.
Missing or incompatible targets fail closed on mobile changes. Android remains
blocked until its own native-runtime and OTA acceptance is complete.

Shipping this configuration on the foundation branch does not activate main CI
or establish release readiness. Native checks, coverage, signing, security gates,
CI credentials and end-to-end remote publication remain separate release evidence.

## Verification

Behavioral tests cover main-only automatic alpha, quality prerequisites, branch
and tag isolation, unchanged desktop inputs, strict source-map ordering, explicit
stable group selection, malformed responses, wrong branch/platform/runtime and
rollback rejection. Validate and expand the actual CircleCI configuration before
commit. No user vault is opened or changed to test this CI-only behavior.

## References

- [Expo deployment and promotion](https://docs.expo.dev/eas-update/deployment/)
- [Expo CLI republish command](https://docs.expo.dev/eas/cli/)
- [Apple TestFlight groups](https://developer.apple.com/testflight/)
