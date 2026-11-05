---
type: ADR
id: "0208"
title: "Opt-in optimized native storage QA"
status: active
date: 2026-10-10
---

## Context

Debug Hermes and native-library timings are not release performance evidence.
The existing standalone Git and interrupted-write probes are disabled outside
development builds, preventing the same fixtures from measuring optimized code.

## Decision

Allow those storage probes in an explicitly compiled `MEMORIA_QA` binary as well
as Debug. The native workspace module exposes a read-only capability only under
those compilation conditions. The JavaScript entry point accepts either a
development runtime or that exact native boolean. URL parameters, strings, and
environment variables on their own cannot enable an ordinary release binary.

The probes retain loopback-only transport and disposable app-cache fixtures.
Use the existing Release configuration, embedded production JavaScript/Hermes,
and an explicit command-line Swift compilation condition. Do not commit the QA
flag into the project, release pipeline, or ordinary app settings.

## Consequences

- The same transport, filesystem, and recovery assertions can run in optimized
  code. Simulator measurements still do not establish physical-device budgets.
- Ordinary Release excludes the native probe API/capability. Verify that boundary
  separately, not only that a QA-enabled build works.
- QA-enabled binaries are local test artifacts, not distribution candidates.
  Native fault injection never gains access to the original Laputa vault.
- No dependency or alternate storage implementation is introduced.
