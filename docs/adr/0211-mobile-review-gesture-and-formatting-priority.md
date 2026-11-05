# ADR 0211: Mobile review gesture and formatting priority

Date: 2026-10-11

Status: Accepted; supersedes ADR 0202 for tablet toolbar presentation.

## Context

The physical iPad review requested the source editor's formatting capabilities in
the rich editor, and note-row quick actions instead of panel navigation. Native
QA also exposed panel recognition competing with the formatting scroller.

## Decision

Tablets share the source editor's scrollable command strip with the rich editor.
Both retain 44-point touch targets. Rich selection state drives active controls;
table mutation controls appear only inside a table. Phones retain compact menus.
Command dispatch and document semantics remain shared.

Use the installed Gesture Handler ReanimatedSwipeable for row dragging, snapping
and action reveal. A simultaneous release observer commits only a full swipe:
favorite to the right, archive/unarchive to the left. Delete requires an explicit
button press. Full-swipe distance is 68 percent of measured row width, independent
of velocity; cancelling a gesture never commits. Existing workspace actions own
optimistic state, persistence and undo history.

Panel recognition yields note-row and editor-interior drags. The sidebar surface,
list header and screen edges retain panel navigation, alongside explicit toggles.
Phone responders follow the same ownership rule. Vertical motion remains scrolling.

## Consequences

No new dependency or separate animation engine is introduced. Native regression
tests measure formatting targets and exercise partial/full row swipes, panel
stability and archive recovery. Pure tests cover gesture ownership and thresholds.
Browser tests alone cannot accept these changes.
