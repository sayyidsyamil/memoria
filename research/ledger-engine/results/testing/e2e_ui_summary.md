# End-to-end UI test summary (Playwright)

- Specs: `app/e2e/ledger.spec.ts` (T1-T5, E1) and `app/e2e/ledger-number.spec.ts` (E2), config `app/playwright.config.ts`, command `npm run test:e2e` (`playwright test`, one worker).
- Run on 2026-10-13, re-run on 2026-10-14 after the fonts and CSP change (same results), headless Chromium (headless shell 1223), against `npx vite --port 5199` in browser mock mode (no Tauri, no model, no Python). Viewport 1280x800.
- Mock scenario: `localStorage['memoria:mock-ledger']='fresh'` for T1-T5 and E1, and `'demo'` (the real service output of the fictional series, with the review inbox as it was before review) for E2 (nothing set up, no meetings, no facts); each meeting's facts appear when its note is added. The two onboarding localStorage keys are set to `1`.
- Every test starts from a fresh page load, so tests are independent. Selectors are roles, labels and visible names; there are no sleeps (all waits are Playwright auto-wait or `expect` retries).
- Result: **7 passed, 0 failed, 0 flaky, 0 skipped**, wall time **40.8 s** (re-run on 2026-10-14 after Part 7: misread-number review card, demo mock dataset). Earlier runs: 6 passed in 55.6 s (Part 6) and 87.8 s (Part 5, machine busy with a model evaluation). The per-test seconds below are from the Part 7 run.

| Test id | Steps | Result | Seconds |
|---|---|---|---|
| T1 | Open Decisions from the sidebar; empty state "Nothing is tracked yet"; Setup > Load sample setup; Meetings > Add Steering 1, 2, 3 (each row switches to "Already added"); Now shows Go-live and Pilot budget | pass | 5.3 |
| T2 | Set up and add meetings; Now tab shows Beta Cloud; open Evidence for Vendor; dialog names Steering 2 and shows the Beta Cloud quote; Esc closes | pass | 5.5 |
| T3 | Set up; Fix: Go-live; Save is disabled until a reason is given; enter 2026-12-20 and a reason; Save; toast "Saved: Go-live ... corrected." and 20 Dec shown | pass | 5.9 |
| T4 | Set up; Ask the three example questions (current go-live date; budget on 20 September; number of go-live changes); each answer contains the expected text, an "Evidence" heading and at least one quote | pass | 6.3 |
| T5 | Set up; Prepare shows "open commitments" and "recent changes" headings; Copy as markdown; toast "Brief copied"; clipboard text starts with a heading and mentions Go-live | pass | 6.3 |
| E1 | Set up; make `proposals.accept` fail with `[StaleProposal] ...`; To review > Accept; card shows "This suggestion is out of date because something newer was recorded. It has been refreshed." with no raw error text; Dismiss; toast "Dismissed: ..." | pass | 6.2 |
| E2 | Open the demo data; To review > the Pilot budget card says "The number 2,500,000 does not appear in the quote. Please check it." and shows the quote with 250,000 ringgit; Accept stays enabled; Edit then accept pre-fills 250000; Save and accept; toast "Recorded: Pilot budget (RM) · Amount."; Now shows 250,000 | pass | 3.7 |

Notes
- The mock answers come from fictional mock data (go-live 1, 8, 15 Dec), not from the engine; these tests check the UI flow, not extraction quality (that is measured in the engine evaluation).
- If Playwright's expected Chromium is not installed, set `MEMORIA_E2E_CHROMIUM` to a Chromium binary (this machine needed it).
- Raw report: `app/test-results/e2e-report.json` (git-ignored, regenerated on each run).
