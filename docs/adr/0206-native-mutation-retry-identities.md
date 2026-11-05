---
type: ADR
id: "0206"
title: "Identify completed native mutation retries"
status: active
date: 2026-10-10
---

## Context

Read-side recovery can finish a failed save before the JavaScript write queue
retries it. Treating that retry as a new operation can overwrite an intervening
edit, resurrect a deleted file, or delete a new entry at a reused source path.
The prior structural receipt only handled a missing source; text writes had no
completion identity. This extends ADRs 0203 and 0204.

## Decision

Text saves and entry mutations retain a native-generated UUID across a failed
attempt. The shared JavaScript helper releases it only after success. Before
inspecting the current source or capturing a new precondition, the native writer
checks its bounded, private completion receipt. An exact completed retry is an
acknowledged no-op; reusing an ID for a different payload fails closed.

Text completion receipts contain the relative path and content digest, not the
note body. They are atomically published before removing pending intent. Legacy
version-one text records without an identifier still recover. The new native
`saveWorkspaceText` capability explicitly requires the identity; old standalone
binaries cannot silently accept a call while dropping its fourth argument.

## Consequences

- The existing per-root serialized queue allows one last receipt per mutation
  kind. This is not a historical operation ledger or a multi-file transaction.
- Recovery may finish before a retry, but the retry cannot undo a later edit,
  deletion, or recreation. A genuinely new command gets a new identity.
- Filesystem regression tests cover these boundaries and legacy records. The
  standalone iPad proof verifies the text case across process restarts through
  the actual Expo module and repository, not React Native Web.
- Expo Go and Android keep their existing behavior; no native crash-recovery
  guarantee is inferred for platforms without the capability.
