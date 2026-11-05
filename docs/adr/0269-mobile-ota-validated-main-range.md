# ADR-0269: Mobile OTA Validated Main Range

Platform: mobile

Date: 2026-10-20. Status: accepted.

Amends the change-range and validation-job wiring in ADR 0247. Its native
compatibility, source-map, channel isolation and manual Stable rules remain.

## Decision

Use the current main validation graph before publishing Alpha: static gates,
frontend lint/build and coverage report, Rust coverage and lint, smoke report,
and mobile checks. Preserve main's separate opt-in performance workflow rather
than referencing a job absent from the normal validation graph.

GitHub App pipelines do not reliably provide a push-before revision. The Alpha
publisher therefore restores a main-only successful-check commit from CircleCI
cache and compares that entire range to HEAD. With no marker, inspect repository
history from its root, never only HEAD~1. Reject a non-ancestor base before any
export or upload. A cache miss runs more work but cannot hide mobile changes.

Advance the marker only after a successful publish with a validated receipt, or
a proven desktop-only range. Failed exports, source-map uploads, incompatible
native runtimes and rejected publication receipts cannot advance it. Serialize
Alpha jobs with CircleCI's pipeline-order serial group. Stable and validation
channels never read or write the Alpha marker. Explicit manual base parameters
remain available to operators and must also pass ancestry validation.

## Verification

Regressions verify real job/prerequisite resolution, full-history fallback,
ancestry rejection, desktop-only skips, source-map ordering and native-runtime
validation. Validate and expand CircleCI's actual configuration before release.
Cache behavior and remote publication still require live CI acceptance; local
tests are not evidence that a pipeline published an update.
