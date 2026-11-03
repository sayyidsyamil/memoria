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

(none yet)
