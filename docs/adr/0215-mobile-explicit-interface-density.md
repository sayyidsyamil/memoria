# ADR 0215: Explicit mobile interface density

Date: 2026-10-11
Status: Accepted

## Context

The physical iPad review requests an interface about ten percent larger. Desktop
tokens remain the baseline. Changing font sizes alone crowds native rows;
transforming the root view changes hit geometry and panel behavior. The embedded
editor must also match the native interface without resetting the document.

## Decision

- Installation settings expose Standard (100%) and Larger (110%), defaulting to
  Larger. `mobileMetrics` derives two immutable, shared metric sets from the
  existing desktop parity tokens. Typography, line heights, padding, gaps and
  controls scale together. Panel widths, content maximum width, border strokes,
  corner radii, opacity and font weights retain their canonical values.
- The existing appearance context supplies metrics alongside colors.
  `useMobileStyles` memoizes factories by both identities; pure helpers receive
  metrics explicitly. There is no root transform, mutable global scale or
  workspace remount. Minimum 44-point touch targets remain minimums.
- Rich-editor CSS uses the same metrics, injected separately from content
  synchronization. Source highlighting and its input share the same typography.
- Unit tests check canonical and derived numbers. Native XCTest compares actual
  row dimensions, insets, label line boxes and count-pill centering at both
  settings, then verifies persistence and portrait layout. The existing desktop
  100% layout contracts remain valid and must be exercised at Standard density.
- Successful preference changes use the existing consent-bound
  `mobile_setting_changed` event with setting `uiScale`; no content is recorded.

## Consequences

New mobile surfaces use metrics from the appearance context rather than importing
fixed spacing or font tokens directly. Pure parity contracts remain unscaled and
continue detecting desktop drift. This preference is an explicitly requested
mobile adaptation, not permission to invent different component layouts.
