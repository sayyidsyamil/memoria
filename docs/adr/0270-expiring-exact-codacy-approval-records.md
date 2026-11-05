# 0270: Expiring Exact Codacy Approval Records

Date: 2026-10-20
Status: Accepted
Platform: shared

## Context

The repository owner approved specific false-positive security reports for the
initial internal mobile Alpha through October 21. The differential push gate
continued to block those same reports, despite complete per-file analysis.
Bypassing hooks or disabling entire rules would broaden the approval.

## Decision

Keep all analyzers enabled. Partition only the explicitly approved reports by
exact repository-relative path, rule, line, and whole-file SHA-256. Print each
accepted report in the gate output. Approval expires at 23:59 Europe/Rome on
October 21, and does not apply to Stable-channel jobs. Changed source bytes,
additional reports, unavailable files, scanner errors, and expired approvals
remain blocking. No dependency advisory is covered by this registry.

The original authorization is Luca's response to
`call_355180105f3041c2888d7259418acb80`; the detailed release record is TOL-96.

## Consequences

Normal verified hooks and CI can honor the exact temporary authorization without
concealing reports or weakening rules elsewhere. The registry must be removed or
reviewed within seven days. Expiration blocks affected pushes automatically;
renewal requires explicit repository-owner approval, not an agent date change.
