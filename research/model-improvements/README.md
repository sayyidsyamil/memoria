# Model improvements: extraction quality, and the edited Qwen3.5-0.8B

**Status (3 November 2026, 18:33): development complete; new-val not opened.** Candidate A is frozen
(`results/validation/candidate-A.json`) and **rejected for default deployment**: it fails two of three product-contract
fixtures (see "Product-contract review" below); validating it would only test an experimental one-value-per-meeting
policy. Baseline audit (empty-record floor, per-type and paired results, scorer false credit):
[`baseline-audit.md`](baseline-audit.md). On the user's steering the final validation waits until separate
specialists report their own 4B candidates (weight-space repair of repetition loops, attribution edits); all
candidates are then preregistered together with an explicitly frozen current production baseline, and the reserved
validation series are run once. Protocol and amendments: [`PROTOCOL.md`](PROTOCOL.md). Dated notes, including every
rejected idea: [`WORKLOG.md`](WORKLOG.md).

Everything below is **development data** (old-dev ES2003, TS3004 and new-dev ES2011, IS1008, TS3006: 20 meetings,
60 gold events, 124 questions), already used to choose among variants, so the candidate's numbers are optimistic.
No number here is a held-out result.

## Answers so far

1. **The 0.3.1 extraction was weaker than the configuration evaluated in October.** On old-dev the app's request
   answers 27/45 questions against 35/45 for October's request with the same model and prompt (0 only-app against 8
   only-October, p = 0.008). One cause is identified: `temporal_service.repaired` drops amounts whose quote spells the
   number ("twelve point five Euros per unit"; keeping them recovers 3 gold events and 3 answers on dev). The other
   difference is the worker's JSON system message: without it the 4B marks far more events unresolved and writes fewer
   wrong changes, but on the full dev set that effect alone is within the run-to-run movement of greedy decoding
   (QA 95 vs 90, p = 0.36; 90 again in a closed-loop variant), so it is a hypothesis, not a finding.
2. **QA has a high floor** ([`baseline-audit.md`](baseline-audit.md), measured with the real engine and both
   routers). An empty record answers 58 of October's 96 test questions and 69 of the 124 dev questions: on the 96,
   every past-date question has the answer "none" and 29 of 33 change counts are 0; only 38 questions need a value or
   a real change. **October's 4B ledger headline (59/96, 61%) is indistinguishable from recording nothing** (18
   questions only the ledger gets right, 17 only the empty record, p = 1.0); it has 18/34 current values and none of
   the 4 real changes. The published comparisons with full context (41) and BM25 (37) stand, but the ledger leads only
   on the "none"/0 questions; on the 38 that need a value it is behind both (18 against 26 and 23). Every filter gains
   QA by writing less, so filters are judged against random removal, and current values and real changes are read
   separately.
3. **Best 4B candidate on dev (A):** request without the system message, amounts in words kept, replies stopped at
   their first repeated event, and one value per tracked item per meeting (the value written most often). QA 100/124
   against 90 (17 only-A against 7 only-app, p = 0.064), gold events found 28 against 26, wrong-value writes 31 against
   46, review inbox 89 against 119 proposals (-25%) with 27 correct proposals against 25. All of the gain is in change
   counts (35 against 26 of 43); current values are unchanged (28/43). It costs 16% more generation time per meeting.
   **Its per-meeting rule breaks the product contract** (an explicit later decision can be outvoted by repeated recaps
   of the old value; an approved intermediate change is dropped), and a contract-respecting variant keeps almost none
   of the gain, so the dev gain is not a product improvement as it stands.
4. **The 0.8B is not deployable for these tasks, edited or not.** As the live guard it never alerts (AUROC 0.62-0.63
   against 0.97 for the 4B); it routes 95-103 of 124 questions right in bf16 (4B: 124) and 52-53 in 4-bit; it finds
   2-6 of the gold events the 4B finds 13-16 of. The edit is real and transfers to Memoria's thinking-off JSON
   requests: far fewer replies run into the token budget (bf16 41 -> 23 of 56; 4-bit 34 -> 11 of 41) and routing
   improves (9 questions gained, 1 lost, p = 0.021), but it does not close the gap. A resident 0.8B beside the 4B would
   add memory (0.5-1.6 GB of weights), not save it.

## 4B on development data

"App" / "shipped" in this folder always means the **historical app path at `f45bbe549` (the 0.3.1 release)**: the
harness imports that commit's `temporal_service.py` and `model_server.py`. `main` has since changed production
extraction (`70707fa3b`: amounts in words, exact numeric parsing, quote and singleton fixes), so these figures are
historical, not current `main`; see [`baseline-audit.md`](baseline-audit.md). Open loop = a filter on the app run's
candidates (its prompts fixed);
closed loop = the configuration's own beliefs in its later prompts. Empty ledger: 69/124. Regenerate with
`python3.11 dev_tables.py` (no model; 27 s).

| configuration | QA /124 | current /43 | as of /38 | changes /43 | gold found /60 | wrong writes | inbox | correct proposals | QA after review | gen s / meeting | only / only vs app, p |
|---|---|---|---|---|---|---|---|---|---|---|---|
| app path at f45bbe549 / 0.3.1 (historical baseline) | 90 | 28 | 36 | 26 | 26 | 46 | 119 | 25 | 92 | 57.6 | |
| + amounts in words kept (open loop) | 93 | 31 | 36 | 26 | 29 | 46 | 122 | 28 | 95 | 57.6 | 3 / 0, 0.25 |
| + stop at the first repeated event (open loop) | 90 | 28 | 36 | 26 | 26 | 46 | 119 | 25 | 92 | 54.3 | 0 / 0 |
| support check, tau 0 (open loop) | 87 | 23 | 36 | 28 | 23 | 27 | 80 | 22 | 89 | 57.6 | 3 / 6, 0.51 |
| lexical support control (open loop) | 92 | 24 | 37 | 31 | 24 | 28 | 84 | 23 | 89 | 57.6 | 6 / 4, 0.75 |
| re-anchor or drop unsupported quotes (open loop) | 95 | 29 | 37 | 29 | 27 | 36 | 103 | 26 | 93 | 57.6 | 5 / 0, 0.062 |
| last value per slot per meeting (open loop) | 97 | 28 | 36 | 33 | 20 | 35 | 95 | 19 | 87 | 57.6 | 8 / 1, 0.039 |
| commonest value per slot per meeting (open loop) | 98 | 30 | 36 | 32 | 21 | 30 | 97 | 20 | 89 | 57.6 | 10 / 2, 0.039 |
| model consolidation, thinking off (open loop) | 102 | 32 | 36 | 34 | 23 | 29 | 96 | 22 | 89 | 57.6 | 13 / 1, 0.002 |
| request without the JSON system message (nosys) | 95 | 27 | 37 | 31 | 29 | 45 | 100 | 27 | 97 | 67.1 | 12 / 7, 0.36 |
| nosys + commonest value (open loop) | 102 | 27 | 37 | 38 | 28 | 28 | 84 | 27 | 96 | 67.1 | 18 / 6, 0.023 |
| nosys + model consolidation, thinking off (open loop) | 101 | 27 | 37 | 37 | 27 | 32 | 85 | 26 | 96 | 67.1 | 17 / 6, 0.035 |
| nosys + model consolidation, thinking on (open loop) | 95 | 27 | 37 | 31 | 27 | 44 | 93 | 25 | 95 | 67.1 | 12 / 7, 0.36 |
| nosys + numwords + loopstop (closed loop) | 90 | 25 | 37 | 28 | 29 | 53 | 104 | 27 | 97 | 65.3 | 12 / 12, 1.0 |
| **candidate A = nosys + numwords + loopstop + commonest value (closed loop)** | **100** | 28 | 37 | 35 | 28 | 31 | 89 | 27 | 98 | 67.1 | 17 / 7, 0.064 |

"Wrong writes": writes whose value is not the gold value in force once the meeting's decisions are taken. "Inbox":
belief-changing proposals under the app's `confirm_all` policy with a perfect reviewer (open loop), of which "correct
proposals" match a gold event exactly. Generation seconds are summed model time per meeting on an M5 (16 GB).

**Shipped baseline in detail.** Precision 16.7% [9-28], recall 43% [24-64], F1 24% (bootstrap over meetings); 7.8
writes per meeting, 46 of 156 with a value not in force; 3 of 97 replies ran to 1,800 tokens repeating one event and
did not parse cleanly; window p50/p95 7.9/29.9 s, meeting p50/p95 53/100 s; MLX peak 4.1 GB, process peak footprint
4.9-5.1 GB per job. The router (prompt r1 through the worker) routes 100/124 exactly and 124/124 to a right answer on
gold facts, 2.8 s median. On ES2011 the model found six of nine decisions with the right value but cited other turns
than the human-linked evidence, so the October scorer counts none of them as found: "gold found" understates
value-correct extraction, which is why wrong writes and QA are reported beside it.

**Controls that ruled out easier explanations** (random removal of the same number of writes per meeting, 300 draws,
`controls.py`, results in `results/controls.jsonl`):

| filter on its base | writes removed | QA | random: mean, 90th pct | share of draws >= filter | gold kept vs random mean | passes |
|---|---|---|---|---|---|---|
| lexsupport on app | 49 | 92 | 90.9, 94 | 39% | 24 vs 20.1 | no |
| reanchor:10 on app | 21 | 95 | 92.8, 95 | 15% | 27 vs 23.7 | at the edge |
| commonest value on app | 23 | 98 | 90.5, 93 | 0% | 21 vs 22.7 | no (loses gold events) |
| commonest value on nosys | 21 | 102 | 95.4, 98 | 0.3% | 28 vs 26.3 | **yes** |
| last value on nosys | 25 | 100 | 95.4, 98 | 1.3% | 27 vs 25.9 | yes |

300 draws each (the protocol fixed 1,000; deviation recorded). Rechecked with 1,000 draws (seed 0): commonest value on
nosys, QA 102 against a random mean of 95.4 (90th percentile 98), 2 of 1,000 draws reach it, gold kept 28 against 26.4;
on the base nearest to A (nosys + numwords + loopstop, closed loop; the rule open loop), 30 writes removed, QA 99 against
92.3 (90th percentile 95), 2 of 1,000 draws reach it, gold kept 28 against 25.2, wrong writes 29 against 42.7. The rule
removes better than chance on this data, so its gain is not just writing less; that does not repair its contract failure
(below), and these shares are descriptive (computed after choosing among about 15 variants).

**Rejected, and why** (all on dev):
- *Support check* (one YES/NO question per write about attribution, not firmness): halves wrong writes but drops the
  only write of slots whose value was right with a weak quote; QA and gold events both fall.
- *Last value per meeting* on the shipped request: keeps a late remark over the decision ("I'd say we go two... double
  curved" after single curved was decided); loses 6 gold events.
- *Model consolidation with thinking on*: 13 of 16 questions ran out of a 1,024-token thinking budget (552 s for 16
  questions); no gain. With thinking off it equals the deterministic rule, so ties go to the rule (no model calls).
- *The request without the system message alone* is not shown to help: one closed-loop change of a later prompt moves
  QA from 95 to 90. Greedy decoding of a changed prompt moves a series by several questions; A's robust part on dev
  is one value per slot per meeting on top of that request.
- *Support check only on value changes*: no QA effect (90), inbox -10%.

**Demo regression** (fictional UAT series, 3 meetings, 18 gold events, 21 questions; `run.py extract 4b ... demo`):
the shipped path and candidate A give identical results: 14/18 gold events, 19/21 QA, no wrong-value write, 13
proposals of which 12 correct. old-test (96 questions) is kept for the final regression with the validation.

## 0.8B against the 4B (development data; extraction coverage partial)

Same requests as the app, thinking off, greedy. 4-bit = affine, group 64, quantised in memory from bf16 after the
edit. Regenerate with `python3.11 small_tables.py` (no model).

| | 4B (4-bit) | 0.8B stock bf16 | 0.8B edited bf16 | 0.8B stock 4-bit | 0.8B edited 4-bit |
|---|---|---|---|---|---|
| Guard, bench-dev at the shipped threshold 2.0: caught /20, false alarms /40 | 16, 2 | 0, 0 | 0, 0 | 0, 0 | 0, 0 |
| Guard AUROC (strongest candidate) | 0.969 | 0.629 | 0.632 | 0.619 | 0.620 |
| Routing: right on gold facts /124 (exact; unparsable) | 124 (100; 0) | 95 (85; 15) | 103 (93; 10) | 52 (35; 51) | 53 (39; 54) |
| Routing median seconds | 2.8 | 0.95 | 0.90 | 0.79 | 0.75 |
| Extraction, ES2003+TS3004+IS1008 (bf16 rows): gold found /33; QA /66 | 16; 44 | 6; 40 | 4; 42 | | |
| Extraction, ES2003+TS3004 (4-bit rows): gold found /23; QA /45 | 13; 27 | | | 4; 31 | 2; 31 |
| Replies run to the 1,800-token budget | 1/56 (bf16 set); 1/41 (4-bit set) | 41/56 | 23/56 | 34/41 | 11/41 |
| Generation seconds per meeting | 48.5 (bf16 set); 54.1 (4-bit set) | 149 | 88 | 89 | 38 |
| MLX active after load; process peak footprint | 2.50; 4.5-5.1 GB | 1.56; 3.5 GB | 1.56; 3.5 GB | 0.48; 2.6-2.7 GB | 0.48; 2.7 GB |

The 0.8B's QA is near or above the 4B's only because it writes almost nothing (the empty-ledger floor); its gold
events found and its guard and routing results are the informative rows. Edited against stock routing (bf16): 9
questions only edited routes right, 1 only stock (p = 0.021).

### The edited 0.8B: what was verified before any comparison

- **Identity.** The published p50c diff (`RikiyaT/lm_understand-logs` @ `4d09ba6`) applied to stock
  `Qwen/Qwen3.5-0.8B` @ `2fc0636` gives both edited tensors with the model card's SHA-256. The released checkpoint
  (`RikiyaT/Qwen3.5-0.8B-weight-space-programming` @ `d1671a1`, streamed and hashed, not stored) has the same 488
  tensors, names, dtypes and shapes as stock; exactly two differ (`layers.15` and `layers.19` `mlp.down_proj.weight`);
  config, tokenizer, chat template, vocab and merges are byte-identical (`results/wsp/release.json`).
- **What the edit is**, read from the tensors (`results/wsp/quant.json`): in each of the two layers, 64 of 3,584 MLP
  neurons have the component of their output along one direction multiplied by **-5** (W' = W - 6uuᵀW on those
  columns; rank-1 share 0.99999; nothing else changes beyond bf16 rounding). The post describes it as subtracting the
  direction; the run's final answer says it "counteracts" it. 130,188 bf16 entries differ.
- **It survives 4-bit quantisation** (affine, group 64): the quantised difference has cosine 0.96 and 0.94 with the
  bf16 edit, and the edited neurons' projection on the direction is unchanged (0.153 -> 0.152, 0.120 -> 0.119; stock
  0.031 and 0.024).
- In MLX the edited model is built at load time from the stock weights and the two rebuilt tensors (hash-checked in
  memory), so no second full copy is stored.

## Product-contract review of candidate A (15:36-15:41, no model)

The engine keeps chronology inside a meeting: `Pipeline._commit` gives each write the claim time meeting start + turn
start, commits in turn order and compares each write with the belief in force at that moment, so two real changes in
one meeting are two facts and the later one is current. `test_modevalue_contract.py` runs the real `Pipeline` on
injected candidates, shipped and through A's exact closed-loop gate (`harness._Gated` with `modevalue`):

| fixture (the parent's three cases) | shipped | **A** (commonest value per meeting) | last value per meeting | R (revert only; new, unfrozen) |
|---|---|---|---|---|
| 1. two approved budget changes in one meeting, 250k -> 280k -> 300k | 2 changes, 300k | **fails**: 280k dropped, 1 change | fails the same way | passes |
| 2. "Alpha" restated three times, then "we switch the pilot vendor to Beta" | Beta, 1 change | **fails**: stays Alpha, 0 changes | passes | passes |
| 3. "the vendor is still Alpha" four times | 0 changes | passes | passes | passes |

A's two failures are kept as expected failures; the fixtures were not changed after A's result. Fixture 2 is a
correctness failure: a majority of recap mentions outvotes an explicit later decision and the ledger keeps the old
value. Fixture 3 needs no rule at all; the shipped engine already treats restatements as reconfirmations.

Rule R (`revertonly.py`) drops a change only when the same meeting returns to the value in force before it. It passes
all three fixtures but keeps almost none of A's dev gain (open loop: QA 93 with 23 gold events on the app base, 96 on
the nosys base, 90 on the nosys + numwords + loopstop base). A's dev gain comes from collapsing each meeting to one
value, which is exactly what breaks the contract.

**Recommendation.**
- **Do not offer A as a default.** It can discard an explicit decision (fixture 2) and an approved intermediate change
  (fixture 1).
- **Do not run A as the validation candidate for a product default either.** If the final validation is wanted for A,
  label it "experimental one-value-per-meeting policy" and keep fixture 2 in its report: even a validation win would
  not remove that failure.
- A product option worth considering is an *explicit* "final value per meeting" policy that takes the last value (it
  passes fixture 2, gives up fixture 1's intermediate history by design). It is a new identity: on dev it exists only
  open loop (nosys base: QA 100, current 27/43, 27 gold events; random-removal control passed with 300 draws). It
  would need a closed-loop dev run (GPU) and its own freeze before any validation.
- The parts of A that respect the contract are independent of the per-meeting rule: amounts in words (owned by the
  number-word agent) and stopping a reply at its first repeated event (latency only).

## Validation, prepared and not run

- **Reserved data:** new-val, 8 AMI series never used for extraction (ES2002, ES2005, ES2010, ES2016, IS1001, IS1004,
  TS3005, TS3010): 106 gold events, 247 questions; gold built and hashed before any model read them (commit
  `0a713e9b1`, `data/manifest.json`).
- **Frozen:** candidate A and the hashes of the harness, mechanisms, engine files and data
  (`results/validation/candidate-A.json`).
- **Primary:** QA with exact routes against a production baseline that must be chosen and frozen at preregistration
  (the commit of current `main` and the hashes of its `temporal_service.py` and `model_server.py`; not the historical
  `f45bbe549` path cached here), paired exact sign test, Holm over all candidates
  (A plus any specialist candidates). **Guardrails:** gold events found >= baseline - max(2, 5%); correct proposals
  >= baseline - 2; wrong writes <= baseline; unclean replies <= baseline + 1; current-value questions >= baseline - 2.
  Closed loop; one run; `validate.py` refuses changed files and a second scoring.
- **To run once the parent supplies the specialists' outcomes:** `validate.py prereg A [specialist candidates]`, then
  one `lease.py val-<series> -- <python> validate.py run <series>` per series (about 5-8 minutes each, baseline and
  candidates), then `validate.py score`. Then the regression: old-test (96 questions) for baseline and A.

## Limits

- Development numbers were used to choose among about 15 variants; A's dev gain is optimistic. Five series, one
  machine, one greedy run per configuration; closed-loop prompt changes alone move a series by several questions.
- Gold lists one event per abstract decision, evidence windows come from human links, and the slot lists were written
  by the AI assistant (as in October); precision is a lower bound and "gold found" understates value-correct writes.
- Open-loop inbox counts hold extraction fixed under `confirm_all`; the perfect reviewer is an upper bound.
- `loopstop` is simulated on cached replies (the same greedy prefix); its time saving is estimated from the reply's
  token rate. A worker change is needed to obtain it in the app.
- AMI is public since 2005; pretraining exposure cannot be excluded for any model.

## Reproduce

All commands from this folder. Model jobs go through `lease.py` (shared lock; peak footprint per job in
`results/leases.jsonl`); every model call is cached under `cache/`, so the scoring scripts need no model.

```sh
python3.11 build_gold.py verify-october          # October's 7 chains rebuild byte-identically from the pinned annotations
python3.11 check_harness.py october              # October's replies through this harness give October's numbers
python3.11 test_helpers.py                       # number words, repeated-event cut
python3.11 dev_tables.py                         # every 4B dev table above, from cache/4b.jsonl
python3.11 small_tables.py                       # the 0.8B table, from cache/0.8b-*.jsonl
python3.11 controls.py 4b app-nosys modevalue old-dev,new-dev --draws 300   # a random-removal control
python3.11 audit.py 4b app old-dev,new-dev --md results/audit/x.md          # every write and miss, classified
# with a model (Python with MLX, e.g. /Users/Shared/Memoria/runtime/speech/bin/python):
python3.11 lease.py job -- $PY run.py extract 4b "app-nosys-numwords-loopstop+modevalue" ES2003 TS3004 --minutes 6
python3.11 lease.py job -- $PY run.py guard 4b dev
python3.11 lease.py job -- $PY run.py parity      # in-process requests against the app's model_server.py
```

## Files

| File | What it does |
|---|---|
| `PROTOCOL.md`, `WORKLOG.md` | protocol and amendments; dated notes |
| `lease.py`, `queue.sh` | one bounded model job at a time under the shared model lock; waits (kqueue) while Memoria.app runs |
| `lm.py` | model variants and the app worker's requests, cached (`cache/<variant>.jsonl`) |
| `harness.py`, `score.py`, `audit.py`, `controls.py` | the app's extraction on AMI chains; scoring; per-write audit; random-removal controls |
| `dev_tables.py`, `small_tables.py`, `guard_summary.py`, `route_summary.py` | the tables above, from the caches |
| `support.py`, `consolidate.py`, `numwords.py`, `revertonly.py` | mechanisms tested (R in `revertonly.py` is new and unfrozen) |
| `test_modevalue_contract.py` | product-contract fixtures for A's per-meeting rule (no model) |
| `baseline_audit.py`, `baseline-audit.md` | empty-record floor with the real engine, per-type and paired results, scorer windows |
| `wsp.py` | the edit rebuilt, checked against the release, its survival under 4-bit quantisation, applied at load |
| `run.py` | model jobs (extract, route, guard, parity, suite) |
| `validate.py` | preregistration, single run and scoring of the final validation (not run) |
| `build_gold.py`, `specs_new.py`, `show_abstracts.py`, `data/` | gold for the new series; splits; GSM8K sample (unused) |
| `check_harness.py`, `test_helpers.py` | no-model checks |
| `results/` | leases, controls, guard predictions, audits, dev summaries, edit checks, frozen candidate |
