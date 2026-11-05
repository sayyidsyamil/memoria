# 0219: Bounded mobile background sync

Status: Accepted. Supersedes the foreground-only scheduling policy in ADRs 0212
and 0217, not their conflict, consent or storage rules.

## Decision

Use one lifecycle adapter for AutoGit and linked-folder sync. On departure from
active state, acquire a finite UIKit background task before flushing the normal
editor/save barrier and operation queue. AutoGit remains opt-in; manual Git never
commits on departure. Linked folders flush automatically. Existing active syncs
are joined rather than duplicated. Blocked/conflicted work remains paused.

Commit local Git edits before credential refresh and remote I/O. Integrate clean
divergence as in ADR 0218, then push without force. The background task's expiry
aborts network transport and prevents starting subsequent Git phases. Native
leases end independently of JavaScript, including expiry and module teardown.
Local atomic writes and journaled checkouts retain their recovery guarantees.

Keep existing foreground idle delays and polling intervals. Returning to active
state schedules another eligible attempt after denied execution or cancellation.
Surfaced failures retain the existing error/retry controls; blocked or conflicted
work must be addressed before automation resumes. Do not poll while suspended.
Android currently attempts the
same departure flush without a UIKit lease; this does not claim persistent
Android background execution or Files-provider write-back support.

## Limits and verification

This is a best-effort final sync window, not a background daemon. iOS can deny or
expire it; force quitting or terminating the app does not guarantee a final
commit/push. Files-provider completion does not establish remote iCloud delivery.
No new entitlement, background mode or dependency is required.

Test scheduling, manual mode, save ordering, cancellation, native lease lifecycle
and expiry separately. The opt-in native QA route exercises a real foreground
departure (switching to Settings) with disposable Git repositories and an
isolated linked-folder home.
It is unavailable in ordinary Release and never changes the user's vault catalog.

Reference: [Apple background strategies](https://developer.apple.com/documentation/backgroundtasks/choosing-background-strategies-for-your-app).
