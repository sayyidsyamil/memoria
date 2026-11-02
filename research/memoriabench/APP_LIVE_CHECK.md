# The app's live check on MemoriaBench (roadmap M2)

This bridge evaluates `src-tauri/resources/memory/live_assistance.py`, **not**
`memoria.py`. Historical Macro-F1 0.87 and real-speech false-alert 0.21% do not
transfer to this implementation. Results against the app's resident worker are
under **Results** below.

## Run after rebuilding the app's Qwen worker

Keep the app's one resident model; do **not** run the old `run_benchmarks.py`,
`test_guard_live.py` or launch a standalone model alongside it. Obtain the actual
Qwen socket path from the app's runtime status (`ai_model_status`), or its existing
`MEMORIA_QWEN_SOCKET` configuration. Export that exact path; do not guess a socket.
From the repository root, using an interpreter with the existing research metric
dependencies (NumPy; SciPy only for `--compare`):

```sh
export MEMORIA_QWEN_SOCKET='/actual/path/from/the/app/qwen.sock'
MEMORIA_GUARD=on /opt/homebrew/bin/python3.11 research/memoriabench/app_live_check_bench.py \
  --split dev --limit 12 --output "$TMPDIR/app-live-check-dev-smoke.jsonl"
MEMORIA_GUARD=on /opt/homebrew/bin/python3.11 research/memoriabench/app_live_check_bench.py \
  --split test --output "$TMPDIR/app-live-check-test-on.jsonl" \
  --compare research/memoriabench/results/predictions_raw.jsonl --reference-system M2
```

`--dev` aliases `--split dev`; `--limit N` selects the first N frozen probes **after
loading the full series memories**, so a smoke run does not truncate decisions or
replacement history. `--compare` requires exactly matching probe IDs (omit it for
limited/dev runs). Existing output files are refused; choose new filenames for
repeats. To ablate semantic confirmation, repeat with `MEMORIA_GUARD=off` and a new
output file. Guard-off retains the app's lexical/evidence/subject/numeric gates.
Summary JSON is printed to stdout; predictions include citations, cues, warnings,
status, errors, latency and the exact per-series memory SHA-256. Inspect uncertain
and error counts: offline/old workers are not valid successful-model runs.

The harness refuses real calls without `MEMORIA_QWEN_SOCKET`. It uses the app's
existing verifier and the new socket scorer; neither harness nor scorer imports
MLX, loads weights, or starts workers. An already-running pre-change worker does
not understand scoring: rebuild/restart through the normal app workflow before
the lead's model evaluation. This task itself must not build or restart the app.

## Scoring and guard contract

New newline-delimited socket request:

```json
{"type":"score","messages":[{"role":"system","content":"..."},{"role":"user","content":"..."}],"candidates":["YES","NO"]}
```

Final response: `{"logprobs":{"YES":-0.25,"NO":-2.0}}`, possibly preceded by
existing progress objects. Error objects are rejected; there is no text-generation
fallback. Candidate strings can also be `" YES"`/`" NO"`, but the evaluated pair
is **unspaced `YES` and `NO`**. Each candidate means its **first encoded token**,
not the likelihood of its entire string, and scores are full-vocabulary
log-probabilities, not a renormalized two-way distribution. The worker mirrors
research `guard.ask`: identical chat-template flags (`enable_thinking=False`),
BOS handling, `generate_step(max_tokens=1)`, greedy sampler, prefill size 128.
The client subtracts NO from YES. Generation requests `{"prompt":"..."}` still
use the original JSON system instruction and return the original progress/text
protocol unchanged. The worker serves scoring and generation serially.

The app's existing literal-token relevance selection takes at most five current
facts. A semantic verifier alert is confirmed against its cited current fact using
the **exact research question**, pinned to the same SHA-256 test. Keep at
`log P(YES) - log P(NO) >= 1.0`. If it fails, rank all current slots by IDF-weighted
literal label/attribute overlap; inspect up to three top slots (do not repeat the
cited one), retaining only quoted slots with no deterministic numeric result. Re-cite the
highest confirming slot, replacing the old reason; otherwise drop with a warning.
With the guard on, the narrow question also decides whether the sentence is about
the fact's subject, so the item need not be named (the evaluated research design
has no such gate); with `MEMORIA_GUARD=off` a sentence must still name the item. A scorer error, invalid/nonfinite score, oversized
context or elapsed budget fails closed as `uncertain`, with no semantic cue.
The socket scorer receives only the remaining `CHECK_SECONDS=120` budget (at most
110 s); injected test callbacks own their timeout and late results are discarded.

**Deterministic numeric proofs bypass the model guard**: exact current-slot
equalities with comparable qualified units and matching evidence retain their
original behavior. Legitimate historical mentions, missing/inherited correction
quotes, unknown verifier fact IDs, and pending or future facts remain gated as
before. Snapshot reading and result shape are unchanged.
Unlike research, an unknown cited ID is a schema failure, not a retry candidate.
`live_check(..., verifier=callable, scorer=callable)` injects both model boundaries.

## Mapping and threats to validity

- **Memory source:** use the preserved cached versioned M2 decisions, checking the
  cache's probe/provenance SHA-256 stamps; absolute legacy cache paths are ignored.
  Without that cache, reconstruct using corpus-only `Series(history_only=True)`
  and `generate_bench.memory_for`. No meeting-d reading, embeddings, or research
  model module is used. Cache memory text is separately fingerprinted in outputs.
- **Artificial registry:** one independent text slot per cited decision. The
  label is the sentence's first non-function word; the attribute descriptor is
  the entire current sentence (replacement note removed), and its value is the
  entire current proposition. This deterministic, probe-blind mapping preserves
  all clauses but is **not** normal app extraction or a hand-designed registry.
  Labels such as `remote`, `team`, or `production` make the explicit-subject gate
  conservative; pronouns/paraphrases can be missed. Full-sentence attributes also
  give lexical selection more words than typical user slots. Neither gold label
  nor gold citation is passed to the verifier or scorer.
- **History:** approve each `(replaces ...)` value in the same slot before the
  current decision, through `Service.registry_set`, deterministic
  `meetings_ingest(policy='confirm_all')`, and `proposals_accept`. Real replacements
  use provenance `old_text`/`old_decision`; synthetic replacements are labeled
  synthetic fixtures. Thus old values really are superseded in the ledger, not
  merely included as current facts. Current evidence retains the original note;
  the app still supplies only current facts to model checks.
- **Evidence/time:** AMI summary text is fixture evidence, not a transcript quote.
  Citation minute/second supplies the audio offset; speaker is explicitly `AMI
  decision summary [citation]` (or `Synthetic supersession fixture [fixture-id]`).
  The citation in this non-human label also distinguishes content-identical
  summaries in the ledger's content-addressed sources. Deterministic dates
  2000 (old) and 2001 (current) express ordering, not real meeting dates. Separate
  source entries keep per-decision provenance; no inference on ingestion quality,
  time scoping in real meetings or speaker accuracy is supported.
- **Output:** any cue is an alert; quiet, uncertain and error are no-alert, with
  uncertain/error counts separately reported. `pred=CONTRADICTS` for every alert
  and `pred=INSUFFICIENT_EVIDENCE` otherwise are **binary metric placeholders**.
  The app cannot distinguish OUTDATED/CONTRADICTS or the four silent classes.
  Report alert precision, alert recall, false alarms, counts and latency only;
  do not run the six-class table builder on these placeholders or claim Macro-F1
  comparability. Existing `eval_metrics` supplies binary metrics, percentile
  latencies and (>=10 series) cluster-bootstrap intervals. Optional paired tests
  reuse `stat_tests` McNemar/series sign and binary paired bootstrap only.
- All original limitations remain: mostly synthetic supersessions, clean
  templated English rather than ASR, model-audited labels, approved oracle memory,
  and small samples. Runtime queue contention contributes to app socket latency;
  resident-worker peak memory and live speech behavior are not measured here.

## Results (2 November 2026, installed app's resident Qwen worker)

Test split, 336 probes (112 conflicts, 224 that must not alert), 28 series; 95%
cluster-bootstrap intervals by series. Predictions and the summary are in
`results/app_live_check/`. Research M2 is the historical auditor on the same probes
(`results/predictions_raw.jsonl`).

| App live check | Conflicts caught (recall) | False alarms | Alert precision | Uncertain | Latency p50 / p95 |
|---|---|---|---|---|---|
| **Guard on (final)** | 91 / 112, **81.3%** (75.0–87.5) | 3 / 224, **1.3%** (0–3.1) | 96.8% (93.2–100) | 3 | 4.0 / 6.8 s |
| Guard on, item must be named | 65 / 112, 58.0% (50.0–66.1) | 2 / 224, 0.9% (0–2.2) | 97.0% (93.0–100) | 31 | 3.4 / 5.9 s |
| Guard off, item must be named | 63 / 112, 56.3% (47.3–65.2) | 6 / 224, 2.7% (0.9–4.9) | 91.3% (84.7–97.2) | 33 | 3.7 / 5.7 s |
| Research M2 (reference) | 110 / 112, 98.2% | 1 / 224, 0.4% | | | |

- The guard, with the item-name gate in place, was right on all 6 probes where the
  two runs disagree (exact McNemar p = 0.031): it removed 4 of the 6 false alarms.
- Dropping the item-name gate when the guard is on (final design) was better on 26
  probes and worse on 1 (exact p = 4.2e-7): recall +23.2 points (14.3 to 33.0), false
  alarms +0.4 points (0 to 1.3). 40 of the 47 conflicts the gated run missed failed
  only because the harness label (the sentence's first word, e.g. "team" for "The
  team will not work with teletext") was not in the sentence.
- Against research M2 the final app check still misses more: recall −17.0 points
  (−24.1 to −10.7), false alarms +0.9 points (0 to 2.2), exact p = 1.9e-5.

Failure cases of the final design:

- False alarms (3, all SUPPORTED_CURRENT): "Teletext will not be part of the design."
  confirmed against "Teletext will not be used."; "We will not include a help button
  on the device." against "The group decided not to include a help button…"; and "I
  think the remote will not include speech recognition." re-cited to "The remote will
  include games and a simple parental control feature" (attribution chose a wrong
  slot and the model confirmed it).
- Misses (21): 18 never reached a confirmed clash — the five-fact lexical selection
  did not include the decision (many slots share "remote"), or the app's verifier
  judged no conflict ("Well, we will make the case out of wood." against rubber;
  "So the remote will sell for 35 Euro."); 2 had invalid verifier output; 1 was dropped
  by the guard.
- 6 of the 91 caught conflicts cite a different decision than the reference.

Not measured here: false alerts on real, unrelated speech for the app's own verifier
(the research pipeline's 0.21% does not transfer), speech-recognition errors, and
user-written tracked items instead of the one-slot-per-decision mapping.

## Model-free checks

```sh
cd src-tauri/resources/memory
/opt/homebrew/bin/python3.11 -B -m unittest test_live_assistance test_live_guard test_qwen_scoring
cd ../../../research/memoriabench # or return to repo root, then research/memoriabench
/opt/homebrew/bin/python3.11 -B test_app_live_check_bench.py
```

The harness tests call the real app checker on disposable approved ledgers with
fake verifier/scorer functions; worker protocol tests fake MLX and exercise a
private test socket. No real model is loaded by these checks.
