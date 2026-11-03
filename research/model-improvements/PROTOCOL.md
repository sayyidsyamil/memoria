# Protocol: extraction quality and the edited Qwen3.5-0.8B

Written 3 November 2026, 12:10 +08, on branch `model-improvements` from `main` at `f45bbe549`, before any new
model result. Changes after this point are appended under "Amendments" with a time and reason; nothing above that
line is edited.

## Questions

1. **Audit.** Where does the shipped extractor (Qwen3.5-4B 4-bit, thinking off, through the app's
   `temporal_service.SharedExtractor`: system message, 1,800-token budget, greedy, `repaired`, `WindowedExtractor`)
   lose correct decisions or add wrong ones: semantic errors (tentative remark as decision, wrong item/attribute,
   restatement, missed decision) or mechanical ones (malformed JSON, truncation, repetition, routing)?
2. **Small model.** Can stock Qwen3.5-0.8B or the released edited 0.8B (Weight-Space Programming, Experiment 8,
   `RikiyaT/Qwen3.5-0.8B-weight-space-programming`) do Memoria's small tasks (live-check guard, routing) or
   extraction well enough to lower memory or latency end to end? Does the edit change anything under Memoria's
   settings (thinking off, greedy, short outputs)? Its published gains are with thinking on, 32,768 tokens,
   temperature 0.6, on math and IFEval; they are not assumed to transfer.
3. **Improvement.** Does any mechanism (context, entity/attribute resolution, restatement handling, decoding,
   post-processing, adapter, weight edit) give the 4B more correct grounded decisions or answers without a material
   loss of recall or more false alarms?

## Data and splits (by meeting series)

| Name | Series | Role | Earlier use |
|---|---|---|---|
| old-dev | ES2003, TS3004 (8 meetings, 23 gold events, 45 questions) | development | October dev; firmness gate dev; local-9b; MemoriaBench dev memory (a–c) |
| old-test | ES2004, ES2014, IS1009, TS3003, TS3007 (20 meetings, 46 events, 96 questions) | **regression only**, never for selection | October test; strong-model; firmness gate; app-parity; local-9b check; long-meeting (ES2004b–c); MemoriaBench test |
| new-dev | ES2011, IS1008, TS3006 (official AMI development series) | development | MemoriaBench dev memory (a–c, decisions as text); never extracted |
| new-val | ES2002, ES2005, ES2010, ES2016, IS1001, IS1004, TS3005, TS3010 | **the one final validation** | MemoriaBench test memory (a–c decisions as live-check probes, a different task); never extracted. ES2005 audio was used in a speech room test |
| reserve | ES2006–ES2009, ES2012, ES2013, ES2015, IS1000, IS1003, IS1006, IS1007, TS3008, TS3009, TS3011, TS3012 | untouched; may become later dev or training data | as new-val |
| demo | fictional UAT series (3 meetings, 15 value-changing events) | regression (must stay 15/15 with no wrong value) | model bake-off, UAT |
| bench-dev | MemoriaBench dev, 60 probes (20 conflicts, 40 must-not-alert) | guard development and any recalibration | live-verifier, model bake-off |
| bench-test | MemoriaBench test, 336 probes | **regression only** | revisited many times |

- new-val was chosen without reading anything: of the 23 complete AMI scenario series never used for extraction,
  the lowest SHA-256 of `memoria-model-improvements/validation/2026-11-03/<series>` within each corpus, 4 ES, 2 IS and
  2 TS (proportional to 11, 6 and 6). IS1002 and IS1005 lack a meeting and are excluded.
- **Gold for new-dev and new-val** is built by October's procedure (`ledger-engine/scripts/ami/build_chains.py`,
  imported unchanged, writing only under this folder): every event comes from a DECISIONS sentence of the AMI human
  abstract; the evidence turn is found through the human summary-to-dialogue-act links. Slots and allowed values are
  written from the abstracts (DECISIONS, and alternatives named in ABSTRACT/PROBLEMS of the same series) before any
  model reads those transcripts. Gold for new-val is hashed into `data/manifest.json` and committed before the first
  model call on it. Gold is not edited after any output is seen; a gold error found later is reported, not fixed for
  the run it was found in.
- Caveats carried over: precision is a lower bound (one gold event per abstract decision; restatements count as
  extra); AMI is public since 2005, so pretraining exposure cannot be excluded; I (the AI assistant) write the slot
  lists, as in October.

## Tasks and measurements

- **Extraction (app path).** `SharedExtractor` semantics reproduced in-process from `model_server.py` (system message,
  chat template with thinking off, `stream_generate` greedy, 1,800 tokens) and checked for byte-identical replies
  against the real worker on a few prompts; `WindowedExtractor` (7,000 characters); `repaired`; the engine's
  grounding and validation. Scored with October's `metrics.score_meeting` (immediate policy) and `ledger_answer`.
  Reported: TP, FP, FN, precision, recall, F1 (bootstrap over meetings); wrong-value writes (written value differs
  from the gold value in force); belief-changing proposals per meeting under `confirm_all` and how many are correct;
  QA with exact routes (extractor only) and with the model router; ungrounded, invalid and unresolved candidates;
  replies not parsed cleanly; replies that hit the token budget; repeated identical events in a reply; seconds per
  window and meeting (p50, p95); output tokens; MLX active and peak memory; process peak footprint.
- **Guard.** `live_guard.question` scored by first-token YES−NO log-odds (`model_server.score_first_tokens`) on
  bench-dev through the app's `live_check`; catches /20, false alarms /40, log-odds AUROC, p50/p95.
- **Routing.** October router prompt r1 as the app sends it (worker system message, budget as in the app); exact routes
  and failed parses on old-dev and new-dev questions; seconds.
- Every model call is cached with model, revision, budget and prompt hash; reruns replay. All trials are kept,
  including failed and abandoned ones, with configuration, seed and timings.

## Comparisons, margins and selection (fixed now)

- **0.8B pair.** Stock and edited are compared at the same precision (bf16, and 4-bit affine group 64 quantised in
  memory from bf16 after the edit), same prompts, thinking off, greedy, same budgets. Before use, the edited
  checkpoint is verified tensor by tensor against the stock one (only the two declared `down_proj` tensors may differ)
  and against the model card's hashes. A small model counts as **non-inferior on a dev task** only within these
  margins of the 4B: guard catches ≥ 4B − 2 of 20 and false alarms ≤ 4B + 1 of 40; exact routes ≥ 4B − 5%;
  extraction TP ≥ 4B − 2 and wrong-value writes ≤ 4B. Small dev sets cannot show equivalence; passing a margin only
  permits further testing. A **small-model win** additionally needs lower end-to-end memory or latency counting the
  fallback and the total resident footprint (two resident language models usually cost more, not less).
- **4B mechanisms.** Developed and chosen on old-dev + new-dev only. A filter (anything that removes candidates) must
  also beat 1,000 random removals of the same number per meeting on dev (QA at or above their 90th percentile) and keep
  more gold events than they do on average; otherwise it is rejected regardless of its raw gain.
- **Final validation (new-val), run once** for at most two frozen candidates against the frozen baseline.
  - Primary: QA with exact routes (extractor only), paired exact sign test, two-sided, Holm-adjusted for the number
    of candidates; a win needs adjusted p < 0.05 and a positive difference.
  - Non-inferiority guardrails, all required: gold events found ≥ baseline − max(2, 5% of gold events); correct
    belief-changing proposals under `confirm_all` ≥ baseline − 2; wrong-value writes ≤ baseline; replies not parsed
    cleanly ≤ baseline + 1.
  - Reported, not gating: precision, F1, ext+router QA, proposals per meeting, per-series results, latency (a slowdown
    over 1.5× is reported as a cost), memory.
  - If the validation fails, that is the result; any later work uses newly reserved series.
- old-test, demo and bench-test are run for the final candidate as regressions: report every change; a candidate that
  loses demo events or adds a wrong demo value is not offered as a product option.

## Budget and resources

- At most 6 mechanism families on dev, each with at most 3 variants; every variant is logged in `WORKLOG.md`.
- Model work holds an exclusive `fcntl.flock` on
  `/private/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode/memoria-model.lock` (shared with the release work)
  from loading weights until they are freed; one language model at a time; MLX cache capped at 256 MB; leases of about 10 minutes (one series or one
  task chunk), released between conditions. No model is loaded while Memoria.app or another resident model runs.
- Downloads: stock `Qwen/Qwen3.5-0.8B` (pinned revision) into a private cache here; the edit is rebuilt from the
  published diff and checked against the released checkpoint without storing a second full copy. At least 10 GB of
  disk stays free.
- No paid or remote model calls; nothing private leaves the Mac.

## Amendments

- 12:50, before any app-path dev result except ES2003 (one series, used to debug the harness): the mechanism families
  for dev are (1) amounts written in words kept by the repair step (`numwords`), (2) within-meeting last value
  (`lastvalue`, no model), (3) attribution check by first-token YES/NO (`support`, tau in {-2, 0, 2}; `lexsupport` is
  its lexical control), (4) model consolidation of conflicting values within a meeting (`consolidate`, thinking off and
  on), (5) a worker that stops a reply at its first repeated event (`loopstop`, latency only), (6) one prompt or
  thinking-on extraction variant if (1)-(4) leave a clear error class. Filters are screened open loop (the base run's
  prompts fixed) against random removal; finalists are rerun closed loop on dev (their own beliefs in later prompts).
  Selection on dev: highest QA with exact routes among variants with gold events found >= baseline - 2 and, for
  filters, passing the random-removal rule; ties go to fewer model calls. At most two candidates go to new-val: the
  best one without extra model calls, and the best one with them if it differs.
- 14:28, before any validation run, after finding that an empty ledger answers 69/124 dev questions (56%) and 58/96
  on old-test (as-of-date questions mostly have the gold answer "none", change counts mostly 0): one more guardrail for
  the final validation, current-value questions right >= baseline - 2, so that a gain from writing fewer changes
  cannot hide a loss of decided values. Results are reported by question type with the empty-ledger floor.
- 15:27 (written as 15:35 at first; the commit time is 15:27), scope change on the user's steering, before any result of the new work: (a) the 0.8B comparison stops where
  it stands (guard and 4-bit routing already rule out deployment); in-flight 0.8B jobs and the thinking-on math check
  were cancelled, partial 0.8B extraction is reported as partial; (b) two new 4B candidate families are developed by
  separate specialists in their own directories, not here: weight-space repair of the 4B's repetition/JSON loops
  (`research/weight-edit-loops`) and edits for entity/decision attribution (`research/weight-edit-attribution`); the
  number-word repair in the product is owned by another agent (this folder keeps its research `numwords.py`);
  (c) **new-val stays reserved**: no preregistration and no validation run until the parent supplies the specialists'
  dev outcomes. Candidate A (below, frozen in `results/validation/candidate-A.json`) and any specialist candidate are
  then preregistered together, the Holm correction counting all of them, and new-val is run once. Leases are kept to
  5-8 minutes.
- 15:38, deviation recorded: the filter rule fixed 1,000 random removals; the dev screening used 300 draws per filter
  (`results/controls.jsonl`). The selected configuration's control is recomputed with 1,000 draws (same seed rule)
  and both are reported. Dev p-values (sign tests, shares of random draws) are descriptive: they were computed after
  choosing among about 15 variants and are not corrected for that selection.
- 15:38, product-contract review of candidate A (no model; `test_modevalue_contract.py`): A's per-meeting rule fails
  two of three contract fixtures the parent specified (it drops an approved intermediate change, and lets a repeated old
  value outvote a later explicit decision). A stays frozen and unchanged. A contract-respecting rule written afterwards
  (`revertonly.py`, rule R) is a new, unfrozen identity with open-loop dev checks only; it is not a validation
  candidate unless it passes closed-loop dev checks and is preregistered by name.
- 18:33, baseline for the final validation: every cached "app" figure here is the app path at `f45bbe549` (0.3.1).
  `main` (`70707fa3b`) has since changed production extraction, so the preregistration must name and hash the
  contemporary production baseline (commit, `temporal_service.py`, `model_server.py`) beside every candidate; the
  f45bbe549 figures are reported as historical. Candidate A remains frozen and is rejected for default deployment.
  Reports give the empty-record floor, per-type scores and the needs-a-value subset beside the aggregate
  (`baseline-audit.md`).
- 18:45, two harness integrity issues found by the parent's review, disclosed and fixed (research files only):
  1. **Reserved data were parsed into memory.** `harness.load_series` called the engine's folder-wide `load_chains`
     and filtered afterwards, so every load of a new-dev series parsed all eight new-val chain and question files into
     the process's memory (a spy confirms: 16 reserved files opened for one new-dev series). No reserved series was
     ever sent to a model, extracted, routed or scored, and no reserved content was printed or used; but the earlier
     wording "not opened by any other script" and "never read" was false. Gold building also read the reserved series'
     AMI abstracts (to write `specs_new.py`) and transcripts (October's builder), and freezing hashed their chain files;
     those reads were by design. The loader now reads exactly the requested file (`read_chain`, the engine's
     `parse_chain`/`parse_ask`), and `test_integrity.py` denies every reserved file at the operating-system open call
     while it loads development series and recomputes the dev and audit summaries. The reserved split stays reserved;
     it is not described as wholly unseen data.
  2. **The historical baseline was not pinned.** The harness imported `temporal_service.py`, `model_server.py`,
     `ask_facts.py`, `live_guard.py` and `live_assistance.py` from whatever checkout it ran in; on `main`, two of them
     differ, which would silently change "app" and cause cache misses. The `f45bbe549` copies (byte-identical to
     `v0.3.1-uat`) are now archived in `pinned/f45bbe549` with a manifest; `pinned.py` checks their hashes and those of
     the 69 engine, script, data and result files read in place, puts the copies first on the importing process's path
     only, and refuses to run if an app module was imported from elsewhere. Numbers are unchanged: the dev tables, the
     baseline audit and October's replay reproduce exactly, here and in a checkout of `main` (`c9357d693`).
  These change the harness identity after candidate A's freeze. `results/validation/candidate-A.json` is not rewritten:
  it records A as frozen at commit `a78112dee`, whose app modules were the same `f45bbe549` files now pinned.
  `validate.py` now requires a named, frozen baseline identity (only `app@f45bbe549` is defined) and warns that A is
  rejected. Corrections to earlier text: stopping at the first repeated event is not latency-only (it drops distinct
  events after a repeat, and did so on dev); the scorer's precision is not a lower bound (incomplete gold
  under-credits, wide windows over-credit); "indistinguishable from an empty record" means no paired difference was
  detected on a reused set, not equal performance.
