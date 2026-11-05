# System test on the fictional demo series (extractor: mlx)

Through the app's JSON service. Wall time 67.7 s. Reviewer: accept_all. Inbox held 5 proposal(s): 5 accepted (0 after fixing the number from the quote), 0 rejected as not in the answer key, 0 rejected as stale.

- Facts after review: 10/12 slots match the answer key; phantom facts (value where none expected): 0.
- Questions: 18/21 correct (current 7/9, as_of_valid 4/5, as_of_tx 1/1, n_changes 6/6).
- Health check: {'ok': True, 'problems': []}

| Q | Type | Question | Gold | Answer | OK | Evidence shown |
|---|---|---|---|---|---|---|
| q1 | current | Which vendor are we using for the pilot now? | Beta Cloud | Beta Cloud | yes | yes |
| q2 | current | What is the pilot budget at the moment, in ringgit? | 280000 | 280000 | yes | yes |
| q3 | current | What is the current go-live date? | 2026-11-09 | 2026-11-09 | yes | yes |
| q4 | current | When is the data migration due now? | 2026-10-23 | 2026-10-23 | yes | yes |
| q5 | current | Who owns the data migration? | wei_ling | wei_ling | yes | yes |
| q6 | current | Who is responsible for staff training? | aisha | aisha | yes | yes |
| q7 | current | When is staff training due? | 2026-11-03 | 2026-11-03 | yes | yes |
| q8 | current | What is the status of the security review? | done | none | NO | no |
| q9 | current | Who owns the security review? | wei_ling | none | NO | no |
| q10 | as_of_valid | What was the pilot budget on 27 September 2026? | 250000 | 2500000 | NO | yes |
| q11 | as_of_valid | What was the go-live date on 5 October 2026? | 2026-10-26 | 2026-10-26 | yes | yes |
| q12 | as_of_valid | Which vendor had been chosen on 20 September 2026? | Alpha Systems | Alpha Systems | yes | yes |
| q13 | as_of_valid | What was the data migration deadline on 10 October 2026? | 2026-10-09 | 2026-10-09 | yes | yes |
| q14 | as_of_valid | Who owned the security review on 20 September 2026? | none | none | yes | no |
| q15 | as_of_tx | Going by what had been recorded by 6 October 2026, what was the go-live date for 16 October 2026? | none | none | yes | no |
| q16 | n_changes | How many times did the vendor choice change? | 1 | 1 | yes | no |
| q17 | n_changes | How many times did the pilot budget change? | 1 | 1 | yes | no |
| q18 | n_changes | How many times did the go-live date change? | 1 | 1 | yes | no |
| q19 | n_changes | How many times did the data migration deadline change? | 1 | 1 | yes | no |
| q20 | n_changes | How many times did the training deadline change? | 1 | 1 | yes | no |
| q21 | n_changes | How many times did the owner of the security review change? | 0 | 0 | yes | no |
