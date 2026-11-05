# ADR 0213: Desktop-derived mobile appearance

Date: 2026-10-11
Status: Accepted

## Context

The iPad review requests desktop dark mode and reliable cross-platform visual
parity. Native style objects currently capture light colors at module load.
Changing only the root background or NativeWind classes leaves those surfaces,
icons and the embedded editor unchanged. A platform-specific color API would
also leave Android and web previews inconsistent.

## Decision

- Desktop `src/index.css` remains the palette source of truth. A build-time
  PostCSS parser exports both semantic palettes, including inherited variables
  and resolved aliases, into a small native JSON artifact. PostCSS 8.5.25 is a
  development dependency only. Unit tests compare the artifact with desktop CSS
  so a token edit requires regeneration rather than silently drifting.
- Installation settings select System, Light or Dark. A React context publishes
  the resolved immutable palette. NativeWind/RNR classes receive equivalent CSS
  variables; explicit native styles and icons read the same palette. Memoized
  style factories replace module-level color snapshots without mutating globals
  or remounting the workspace.
- Rich-editor appearance is injected as CSS independently of initial document
  synchronization. Changing appearance must not rewrite content, reset cursor
  selection or alter the note's frontmatter. Source syntax rendering likewise
  uses the active palette.
- Display colors are distinct from content colors. Selecting a dark theme does
  not alter saved highlight colors or arbitrary color-property values.
- Native QA samples actual rendered panel/editor pixels, verifies persistence
  across relaunch, and retains screenshots. Browser previews are supplementary,
  not evidence that native styling works.

## Consequences

Regenerate palettes with `node apps/mobile/scripts/generate-desktop-themes.ts`
after a desktop token change. No CSS parser ships in the native bundle. New UI
uses `useMobileColors` or `useMobileStyles`, while pure helpers receive colors
explicitly. Appearance changes remain separate from document and Git state.
