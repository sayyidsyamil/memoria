# Memoria Unslop polish

Applied using the Unslop method by Damir Sokolovsky
([@heydamir](https://x.com/heydamir)),
[heydamir/unslop](https://github.com/heydamir/unslop), CC BY 4.0.
This document adapts that method; application code retains its existing licence.

## Direction

### Navigation and interaction follow-up

The document library is now an explicit collapsible sidebar section beneath meeting
tools, rather than an unlabeled competing navigation stack. The library starts open
to preserve access to existing files, types, folders, and views. Recordings and briefs
sort newest-first. Loading messages appear in the current list, and request versions
prevent a delayed response from an old tab overwriting the active tab's error/loading
state. Regression coverage exercises out-of-order responses and list ordering.
Narrow meeting headers, summary actions, and player footers wrap instead of squeezing.

Verification: desktop TypeScript, scoped ESLint, all 69 scoped frontend tests, and
12 targeted sidebar type/view interaction tests pass. The native debug bundle was
built and installed; agent-desktop window captures confirmed that the Document
library expands and collapses while meeting navigation remains accessible. Native
dark mode, minimum-width layouts, and the live recording journey still require
their own acceptance pass. No new recording was started during this check.

### Experience refinement — 2 November 2026

The next pass corrects hierarchy rather than adding decoration. The memory hub now
has a visible page title and a short purpose line. Meeting outcomes have their own
heading, a compact approval count, and one Create brief action. Key moments are a
plain timeline rather than stacked cards. Single-speaker meetings do not show a
meaningless 100% participation chart. Ask uses an evidence icon and a clear question
heading; transcript creation no longer claims guaranteed accuracy.

Save errors now appear outside individual tab panels, so a failed Save & close
remains visible from Summary and Ask. A regression test covers the Summary case.

Verification: 67 focused frontend tests, TypeScript, scoped ESLint, and native debug
build pass. The exact build was installed and Meetings, Summary, and Ask were
inspected using agent-desktop window captures. Summary/Ask publication images were
refreshed from that build. Recording, native dark mode, and narrow native layouts
were not re-tested during this refinement. Perfection is not an acceptance claim;
the larger inherited workspace still needs further interaction-level evaluation.

### Product-wide follow-up

The 1 November follow-up applies to the desktop workspace, shared meeting
components, recording HUD, mobile palette, public landing page, documentation
chrome, and GitHub README. Direction: calm, precise, editorial; the product's
world is working notes and source documents. Signature: timestamp → quote →
approved outcome. Existing features and evidence remain intact.

Audit: competing font stacks, tracked uppercase labels, saturated chrome,
over-rounded controls, bouncy tab motion, arbitrary spacing, brown-tinted dark
surfaces, and marketing claims inherited from Tolaria. The README's badge stack,
equal-card tour, added screenshot backdrop, and mixed alignment obscured the UI.

Passes:

1. Spacing: 4px rhythm for shared tabs, navigation, hub headers, and form controls.
2. Color: graphite surfaces in both themes; neutral primary controls, semantic
   feedback, and evidence accents inside content.
3. Icons: existing Phosphor set; neutral avatars and no added decorative icons.
4. Copy: plain meeting-workflow wording; remove inherited sponsor/download claims
   from the Memoria landing page.
5. Type: shared Inter stack, sentence-case labels, readable metadata, restrained
   headings, and a legible recording timer.
6. Layout: editorial landing sections and a plain README with two readable images,
   instead of equal marketing cards and half-width screenshots.
7. Details: 8px controls inside 12px groups, quiet state indicators, fewer pills.
8. Visuals: native product captures without an added presentation backdrop.
9. Motion: remove bounce, pulsing recording decoration, and animated bar geometry;
   retain short purposeful feedback and reduced-motion support.

Scope note: shared tokens propagate to inherited views; this is not an exhaustive
native audit of every editor, mobile, or settings interaction. Native recording
acceptance remains a separate task. The screenshot archive predates this follow-up
and is labelled accordingly until new native captures are made.

Verification: desktop TypeScript, 66 scoped frontend tests, landing TypeScript and
production build, mobile TypeScript and the mobile palette test pass. The updated
native debug bundle builds. Representative Summary and dark Ask layouts were
inspected in the fixture harness; the website was inspected at desktop and narrow
widths. The docs CSS follows the same typography and neutral-navigation treatment;
the full documentation site and every inherited mobile screen were not visually
audited in this pass.

- Product: meeting knowledge with inspectable evidence.
- Character: calm, precise, readable.
- World: working notes and source documents.
- Moments: document content and import review, without generated decoration.
- Signature: consistent evidence links.

## Audit and bounded passes

The existing workspace merits polish, not a redesign. Preserve its layout,
features, real content, existing fonts and palette, and the floating AI control
the user explicitly asked to keep.

1. Spacing: consistent import rows with 12px vertical padding.
2. Colour: preserve neutral chrome and existing meaningful accent colours.
3. Icons: retain the existing Phosphor set; add no decorative symbols.
4. Copy: plain import instructions; separate file constraints from the task.
5. Type: section labels use readable 12px sentence case without tracking.
6. Layout: retain sidebar actions and modal import; no new panels or dashboards.
7. Details: sidebar counts are quiet tabular figures, not filled pills.
8. Visuals: existing evidence content carries the screen; no generated images.
9. Motion: dialogs use a short 150ms fade with reduced-motion support, no zoom.

This is an applied polish pass, not an installed agent skill or an automated
Unslop certification. No paid image generation or story video was requested.
