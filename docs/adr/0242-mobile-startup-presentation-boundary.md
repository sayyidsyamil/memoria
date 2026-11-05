# 0242: Mobile startup presentation boundary

Date: 2026-10-18
Status: active
Platform: mobile

## Context

ADR 0241 separates cached metadata from editable snapshots. Startup still showed
only a loading screen while the fresh native index prepared. Racing the two
readers was not sufficient: the installed Expo SDK uses a shared serial queue
for module async functions, including the index and crypto operations. Native
recording showed that the first version displayed its preview only shortly
before the authoritative workspace. Layout callbacks alone overstated that gain.

## Decision

After restoring a validated catalog selection, replay/check the managed root and
read its config under the existing workspace operation barrier. Release that
barrier before reading private cache data. Give this best-effort presentation
lookup a 250 ms waiting budget before starting authoritative preparation. A
child cancellation signal belongs only to the preview; timeout never cancels
fresh indexing. Ignore late cache IO and remove timer/parent-signal listeners.
Synchronous JavaScript cannot be preempted by this timer; existing cache size and
shape limits remain required.

Keep provisional presentation out of the repository, editor, write pipeline and
sync contracts. While initial restoration is pending and there is no active
workspace, compose the existing sidebar/note-list panels with an inline loading
status. Cached controls are inert and hidden from accessibility navigation; the
root exposes its busy state. Hide creation until authoritative readiness. Reuse
the phone toolbar, primary-list property display, design metrics and tablet
panel defaults rather than introducing another visual design.

Apply the known top inset through the shared panel wrapper's existing inset
context, rather than waiting for a newly mounted native `SafeAreaView` to measure
it again. The native recording exposed a temporary 24-point zero-inset layout
during takeover. Both preview and authoritative panels now commit the same top
padding immediately, while retaining panel backgrounds, dividers and rotation
updates. This follows the [safe-area consistency guidance](https://reactnavigation.org/docs/handling-safe-area/#the-usesafeareainsets-hook)
without adding a second inset owner or restoring the removed bottom bar.

Publish catalog restoration as one state record and clear preview data on
success, failure, retry and cancellation. Do not replace or remount an existing
editable workspace because a cached result arrives or startup state changes.
The original fresh-index, source comparison, recovery and save barriers remain
the only route to an editable workspace. A cache miss/failure is not catalog
corruption and does not invent an empty vault.

## Verification

Behavioral tests cover root/recovery ordering, queue release, timeout isolation,
late results, retry/unmount races, original registry-versus-selection errors,
inert presentation, panel defaults and existing-editor mount preservation.
Native QA uses disposable 9,000-note vaults, cold/warm relaunch, actual UIKit
editing with frontmatter readback, and restoration of original catalogs/files.

Record the actual simulator display in addition to collecting layout metrics.
The host-side video audit samples frames at 100 ms intervals, recognizes the
owned fixture text and inline loading status, saves representative images, and
requires preview-before-ready without a later return to preview. These are
sampled observations, not exact frame-time or production interactivity metrics.
Do not use OCR bounding boxes as spacing measurements: they varied with opacity,
edited titles and iOS window animation even when native geometry was unchanged.
Use the real native layout callbacks for the numerical check instead. The
disposable iPad fixture must retain its known 24-point top inset from the first
authoritative callback through the settled layout. The captured pre-fix callbacks
showed zero before changing to 24. Keep recorded frames as separate presentation
evidence, not a substitute for native geometry or editor-readiness checks.
Existing keyboard/focus and browser fallback checks remain required.

## Limits

This makes cached metadata visible sooner; it does not make cached sources
editable, skip a disk scan, release the retained launch index, or implement an
incremental authoritative index. Those remain separate work. A source failure
still leads to the existing recovery UI rather than an editable cached vault.
