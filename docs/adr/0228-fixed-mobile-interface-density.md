# ADR 0228: Fixed mobile interface density

Date: 2026-10-17
Status: Accepted
Platform: mobile
Supersedes: ADR 0215 (density choice and default only)

## Context

The owner requests a single, larger mobile interface equivalent to 120% of
desktop, with no density switch in Settings. Existing installations may have
persisted the former Standard (100%) or Larger (110%) preference.

## Decision

- Reuse the desktop-derived `mobileMetrics` recipe at 120%. Typography, line
  heights, padding, gaps and controls scale together, without a root transform.
- Normalize valid legacy density preferences to 120% when loading settings.
  Keep validation of malformed settings and preserve all unrelated preferences.
- Remove density selection from Settings. System accessibility text scaling
  remains enabled; 120% is the app baseline, not a cap on accessibility sizing.
- Keep the canonical 100% metrics for desktop-parity tests. Panel widths,
  document maximum width, strokes, corner radii, opacity and font weights retain
  their existing values. Rich-editor CSS uses the same 120% metrics as native UI.
- Verify numerical token derivation, legacy preference migration and actual
  native iPhone/iPad layouts. Screenshots supplement, not replace, geometry checks.

## Consequences

Density no longer represents a user action, so no new analytics event is emitted.
Theme selection still uses the existing appearance preference and event. This
change does not rewrite notes, vault metadata or editor document state.
