# 0221: Mobile sync retries and short write barriers

Date: 2026-10-13
Status: Accepted for the mobile foundation branch
Supersedes the full-operation editor blocking policy in ADR 0212.

## Decision

Serialize Git sync operations independently of the working-copy write queue.
Pause, flush and drain editor writes at the local checkpoint and incoming checkout
boundaries only. Release the barrier during credentials, fetch and push. Checkpoint
again after fetch so edits made during its network wait participate in the merge.
Manual Git still refuses uncommitted changes. Unknown local mutation failures
retain the existing journal/reload safety path; unchanged checkpoints resume the
same editor without resetting its selection or undo history.

Retry recognized transport failures with 30-second exponential backoff capped at
five minutes. New edits and periodic polls do not erase the retry deadline.
Background, disabled or blocked schedulers do not poll. Foreground return and
network reconnection allow pending work to resume. Authentication, conflicts and
unrecognized local failures require explicit attention instead of retry loops.
Temporary failures leave the editor available and do not open a modal.

Use Expo's SDK-compatible `expo-network` event subscription on iOS and Android
rather than separate custom native reachability implementations. Connectivity is
only a retry hint, not proof that GitHub is reachable; actual request outcomes
remain authoritative. No IP address or network identifier is requested or logged.

## Consequences

Local checkpoints and applying incoming files can still briefly pause editing.
Network latency no longer extends that pause. Linked Files-provider reconciliation
retains its coordinated filesystem barrier; provider access is not a Git HTTP
request and cannot safely drop coordination during writes.

Reference: https://docs.expo.dev/versions/v54.0.0/sdk/network/
