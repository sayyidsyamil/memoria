# Amounts stated in words: tracked-fact repair fix

Production change: commit `98440ef50`, `src-tauri/resources/memory/temporal_service.py` (`spoken_numbers`,
`said_in_words`, `repaired`) and `test_temporal_service.py`. Based on 0.3.1 (`1ad62ea78`).

## Problem

`repaired` dropped every number-typed candidate whose quote contained no digits. Manual and spoken
transcripts often write amounts in words. On AMI ES2003a, the 4B model extracted production cost 12.5
from "twelve point five Euros per unit" and price 25 from "sell them for twenty five". Both values were
correct gold events, and both were dropped before review. This was found during the separate model-improvement
experiments; the regression fixture uses the AMI ES2003a turn already represented in this repository.

## Behaviour now

- A candidate's own finite value survives, unchanged and with its quote, when one contiguous number
  phrase in the quote states exactly that value. Supported forms include `twenty-five`, `a hundred and
  fifty thousand`, `twenty five hundred`, `two point five million`, `point oh five` and `minus five`.
- Words only confirm a value. They never supply, replace or rescale one: 125 against "twelve point five",
  25000 against "twenty-five" and 30 against "twenty five" are still dropped.
- If a quote says two amounts, a value matching either survives for review, as with digits
  ("Not 300,000 but 280,000.").
- These phrases confirm nothing:
  - malformed or run-together numbers ("twelve fifty", "twenty twenty five", "twelve point three
    point three");
  - ranges, choices, ratios and sums ("fifteen and twenty five", "twenty to thirty", "one in five",
    "twenty plus five");
  - a hesitation inside a number ("fifty uh million");
  - ordinals and fractions ("twenty fifth", "two thirds", "two and a half million", "half a million",
    "three quarters of a million");
  - percentages ("twenty five percent", "per cent");
  - number words next to digits;
  - unsupported magnitudes ("twenty grand", "five k", "two dozen", "twenty-ish");
  - a bare "one" ("the one", "no one").
- The digit rules are unchanged. There is one deliberate exception: if the quote has one digit amount
  and the value matches a different amount said in words, the value is kept. The old code replaced it
  with the digit amount.

## Verification (deterministic, no model loaded)

- Eight new tests: the real ES2003a turn and the 4B model's cached reply end to end through
  `ingest_reviewed_meeting`, checking proposals, quote, speaker, meeting, audio start and the ledger
  check. They also cover magnitude (12.5 against 125; 25 against 25000), two amounts, a non-matching
  value, negation and sign, ambiguous phrases, no number, unusable values (NaN, ±inf, 10^400, bool,
  None, words, list) and digit quotes.
- Before the fix (same tests, `temporal_service.py` at `1ad62ea78`), five tests fail and one errors.
  The new helper is missing, and the integration test gets 0 proposals instead of 2. After the fix,
  the full memory suite passes: `python3.11 -B -m unittest discover -p 'test_*.py'`, 224 tests (216
  before).
- Read-only cached replay from the experimental `model-improvements` branch:
  `research/model-improvements/cache/*.jsonl` (`4b.jsonl` sha256 `30329c6d8106f22f…`), 5,104
  candidates, went through the shipped and the fixed `repaired` with each chain's registry.
  - 13 results differ, and every difference is a candidate that was dropped and is now kept unchanged.
  - 6 of the 13 are gold events: ES2003a cost 12.5 and price 25, and TS3006a price 25, each in two
    replies.
  - 7 are not gold: restatements, or a stated number written to the wrong item (for example, TS3006a
    "fifty million Euros" as the price). They reach the confirm_all review inbox.
  - The research `numwords.repaired` gives identical results on all 5,104 candidates.
- Protected paths (`memoria_engine/**`, `research/ledger-engine/**`) are unchanged.

### Integration review

Two further regressions were found and fixed before pushing:
- Numeric values are read as numbers, not by stripping letters from their printed representation: `1e20` must not
  be mistaken for 120 and confirmed by "one hundred and twenty".
- Word confirmation uses equality, not a relative tolerance that could accept a nearby but different amount.

Both added tests fail before these corrections. The combined app suite passes 231 tests, including the five separate
singleton-retrieval tests. Replaying all 5,104 cached development candidates gives identical results before and after
these two corrections; no reserved validation series was read.

## Limits

- This is open-loop evidence only. Restored facts enter later prompts and can change greedy
  generation, so no whole-pipeline, native, UAT or model accuracy gain is claimed.
- A quote with one digit amount, plus a different amount said in words, plus a value matching
  neither: the old single-digit replacement still applies. Changing that would also change digit
  quotes that contain incidental number words ("for two branches").
- "twenty or so", "about twenty" and times such as "five o'clock" are read as plain numbers, as their
  digit forms are.
- English only.
