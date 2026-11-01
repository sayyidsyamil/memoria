---
type: ADR
id: "0280"
title: "Debounced push and background fetch for Memoria remote"
status: active
date: 2026-10-23
---

## Context

ADR 0186 established that the Memoria remote commits every save to git and pushes to the upstream remote. The save flow was: fetch from remote, commit the change, push to remote, then respond to the client. This meant save latency included the full push round-trip — acceptable for a local bare repository (about 60 ms in benchmarks) but problematic with a real GitHub remote where each save would add hundreds of milliseconds or more for the network round trip and SSH/HTTPS handshake.

The `s3-spike-report.md` (TOL-5) measured 145 ms per save locally, with push taking 58 ms on average. With a GitHub remote, that push would take 1–2 seconds or more. Background processing of git operations was identified as necessary before real use.

The product requirement is that saves feel instant to the user. The technical requirement is that commits reach the durable git remote with acceptable latency but without blocking the save response.

## Decision

**Commits happen synchronously on save, but pushes happen asynchronously on a background debounce timer (default 2 seconds). Fetches happen on a background timer (default 30 seconds). The server exposes `GET /v1/changes` as a Server-Sent Events stream advertising commit, pull, push-success, and push-failed events via the `changes.feed` capability. On SIGTERM, the server flushes any uncommitted changes and pushes all pending commits before shutting down.**

Implementation (commits dc221e755 and f102b0495):

- **Debounced push**: after a commit, `Vault` schedules a background push on a debounce timer (`pushDebounceMs`, default 2000 ms). Each new commit resets the timer. When the timer fires, all pending commits are pushed. `pushDebounceMs=0` restores the inline push-per-save behavior of ADR 0186.
- **Background fetch**: `Vault` runs `fetch` + integrate on a timer (`fetchIntervalMs`, default 30000 ms). Fetches happen independently of saves.
- **Shutdown flush**: on SIGTERM, `Vault.flushAndPush()` commits any staged changes and pushes all pending commits. If the push fails, a warning is logged with the count of unpushed commits.
- **Change feed**: `GET /v1/changes` opens a Server-Sent Events connection. The server emits `ChangeEvent` on every commit (with paths affected), pull (when HEAD moved), push-success, and push-failed (with error message). The `changes.feed` capability advertises this route. Desktop and web clients can subscribe to track vault state in real time without polling or filesystem watchers.
- **Write responses**: `WriteResult`, `RenameResult`, and `DeleteResult` carry `pushed: boolean`. `pushed: false` means the commit is safe on the server's working clone but has not yet reached the git remote. Clients can display this state and subscribe to the change feed for push-success events.

The change feed is implemented in `apps/server/src/changeEmitter.ts` as a Server-Sent Events broadcaster. `Vault` emits events via the `onVaultEvent` callback; `server.ts` wires a `ChangeEmitter` instance into the server and routes `/v1/changes` to it. Protocol version remains 1.2; the route and capability are additive to the 1.1 file and collaboration API.

## Alternatives considered

- **Inline push per save (ADR 0186)** (superseded): every save blocks on the push to the remote. Simple and correct, but save latency is unacceptable with a real GitHub remote. This remains available as `pushDebounceMs=0` for environments that require immediate push (e.g., ephemeral server instances with no local persistence).
- **Webhook-driven fetch** (recommended in `s3-spike-report.md`): GitHub can POST to the server when the remote is pushed. More efficient than polling, but requires a publicly reachable endpoint, webhook secret management, and handling webhook delivery failures. Deferred; the timed fetch is simpler and sufficient for M1.
- **Long-lived `git cat-file --batch`** (recommended in `s3-spike-report.md`): replace per-command `git` processes with one persistent process for reads. Would improve read latency but does not address push latency. Orthogonal; can be added later.
- **No background push; push only on explicit sync or shutdown**: simpler, but violates the product requirement that the git remote stays reasonably up to date without user action. A quiet vault would never push.

## Consequences

### Durability

There is a window (at most `pushDebounceMs`, default 2 seconds, but longer if the push fails) where a committed change exists on the server's working clone but not yet on the git remote. If the server's disk is lost in this window, the commit is lost.

This is acceptable under the architectural rule that **no self-managed server may be the only copy of user data** (established in `s3-spike-report.md`, section "Recommendation for M1"). A durable copy must exist in a managed, replicated service. For the Memoria remote:

1. The git remote (GitHub or equivalent) is the durable copy. Commits reach it within `pushDebounceMs` under normal operation.
2. Before the service is opened to general users, the deployment must ensure that a vault whose server instance is lost can be restored from the git remote or an Object Storage backup.
3. The `s3-spike-report.md` recommendation stands: scheduled `git bundle` backups to Object Storage with bucket versioning, so a vault can be restored on another box.

The client is informed via `pushed: false` in write responses and can subscribe to the change feed for push-success. The web client or a monitoring dashboard can warn the user when pushes are consistently failing.

### Push failure handling

- **Network unreachable**: writes succeed and return `pushed: false`. The next write or `POST /v1/sync` retries the push. A `push-failed` event is emitted with the error.
- **Push rejected (remote moved)**: the push fails, the server fetches and integrates, and retries up to three times. If all retries fail, the commit stays local and `pushed: false`.
- **Persistent failure**: if the git remote is unreachable for an extended period, commits accumulate on the server. The server keeps serving reads and writes from its local clone. When connectivity is restored, the next write or sync pushes everything.
- **SIGTERM**: `flushAndPush()` makes a best-effort push. If it fails, the unpushed commits are logged and remain in the working clone. The deployment must handle this case (e.g., the server should not be destroyed until a successful push, or a backup must capture the working clone state).

### What becomes easier

- Save latency is no longer dominated by the push to the git remote. Saves respond as soon as the commit is made, typically under 50 ms even with a GitHub remote.
- Clients can subscribe to the change feed to learn about vault changes (commits, pulls, push results) in real time without polling or filesystem watchers.
- The server can batch multiple rapid saves into one push, reducing the number of SSH handshakes or HTTPS connections to the git remote.
- The desktop app can rely on the change feed instead of a filesystem watcher to detect when the server has pulled new commits from the remote.

### What becomes harder

- The client must handle `pushed: false` and potentially warn the user or retry.
- Clients that need a strong guarantee that a commit reached the remote must subscribe to the change feed and wait for `push-success`, or call `POST /v1/sync` and check `pushed: true`.
- Operational monitoring must track push failures and unpushed commit counts.

### What triggers re-evaluation

- Vaults that are edited at high frequency and must guarantee every commit reaches the remote within a tight bound (sub-second). The debounce would need to be shortened or disabled, but that reintroduces the save latency problem.
- Deployments where the server's working clone is the only copy and no durable remote exists. This violates the architectural rule; the solution is to add a durable remote or Object Storage backup, not to change this decision.
- Observed push failures that persist for long enough that clients or end users are impacted. The solution is likely operational (fix the network or remote) or to add background push retry with backoff.

## Advice

(No external input was sought before making this decision.)
