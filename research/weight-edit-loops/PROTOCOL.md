# Targeted 4B loop repair — development protocol

Frozen 2026-11-03, before new inference, from `225f709fd27779103ea6dc01058776528a74af4b`.
Owner: `weight-edit-loops`; all writes are under this directory or its private scratch.

## Scope and separation

- Shipped `mlx-community/Qwen3.5-4B-MLX-4bit` at
  `32f3e8ecf65426fc3306969496342d504bfa13f3`, local cached weights only.
- Thinking off, greedy, app system message, 1,800 output tokens. Fresh prompt/KV/recurrent
  caches for every request; clear both `model_server._prefix` and `_meeting` at every
  condition change. Never alter the quantised base or shipping code.
- Only ES2003, TS3004, ES2011, IS1008, TS3006. Load their individual `.chain`/`.ask`
  files, not a directory loader that also reads reserved data. No old-test/new-val.
- Reconstruct the **entire** baseline prompt by replaying the coordinator harness with
  a private, hashed cache snapshot. Assert the reconstructed request's hash matches.

## Frozen diagnostic selection

`freeze.py` records all 97 app-path development requests, then deterministically chooses:
all capped requests (three); one clean, nonempty, length-matched normal from each capped
request's series, without replacement; and the longest clean nonempty response in each
of ES2003, ES2011 and IS1008. Selection and hashes go in `data/diagnostics.json`.

The first capped TS3004 request and its matched normal are **derivation** only. The other
two capped TS3006 requests and the remaining normals are independent development checks.
The cached third cap has no exact repeated event: distinguish enumeration overrun from
literal repetition rather than claiming that a duplicate detector fixes both.

## Sequence and hypotheses

1. Actual unchanged generation versus actual online exact-completed-event detection.
   Compare original/generated/returned bytes, actual tokens/time, parsed events,
   grounded valid events, gold event identities, and events appearing after a trigger.
   A syntactically closed truncated response alone is not a quality improvement.
2. Derive contrastive MLP-down output/input activations at matched event-boundary
   positions in the derivation pair only. Identify layers from measured separation;
   do not copy layer IDs or vectors from the 0.8B patch.
3. Screen at most three motivated families, each with a small strength grid:
   (a) rank-one removal/counteraction of the contrastive down-output direction;
   (b) the same direction restricted to high-contrast MLP neuron columns;
   (c) a targeted output-projection/continuation direction if (a)/(b) fail.
   Initial strengths: 0 (identity), 0.5, 1, 2; only extend with a recorded reason.
   A runtime linear residual counts as a weight-equivalent edit, with its overhead
   included. Nonlinear or token-gated interventions must be labelled activation edits.
4. For credible nonzero effects: matched random unit directions at the selected layer
   and matched Frobenius edit norms (seed 20261103), opposite sign/strength control,
   independent development prompts, normal extractions, and narrow Ask/guard probes.

## Decision rule

No selection on aggregate QA alone. A candidate needs fewer **actual** repetitive capped
generations and lower diagnostic p95, no lost baseline gold event identities, no new
wrong-value pattern or broad normal-output damage, and a benefit beyond matched random
edits. Compare it with the simpler stopping rule. Diagnostic p95 is explicitly enriched
for failures, not an estimate of population p95 (only 3/97 baseline requests capped).

Preservation of all distinct grounded baseline candidates is also reported, but grounding
alone does not make an event correct. Exact bytes/parsed-event equality is stronger evidence
for a stopping rule. Report raw parse status separately from JSON closure added by a rule.

## Resource and reproducibility rules

Every model command goes through the supplied `run-exclusive.py` machine-wide lock.
Leases target <= 7 minutes, with a hard process deadline of 8 minutes. Refuse loading
beside Memoria.app or an unowned resident model. MLX allocator cache <=256 MiB;
dequantise at most one projection at a time; no training/autograd/downloads. Model
processes exit before lease release. Record exact config, seed, file/direction hashes,
per-prompt predictions/timings, MLX peak and process peak footprint. Commit locally only.

## Amendments

Append discoveries and revisions here; keep prior results and failed hypotheses.

- 15:50, coordinator steering: a duplicate followed by a distinct correct event is a
  mandatory recovery control. The initial first-repeat rule necessarily fails this
  constructed sequence even though no such recovery occurs in the frozen 97 outputs.
  Keep that rule's timings as a negative/generalisation limitation. Add a conservative
  candidate requiring three consecutive repeated **unresolved** events; valid-event
  duplicates never trigger it. Test `[A,A,B]` and repeat-then-recovery streams, plus a
  labelled forced-prefix continuation of a real development extraction with one
  duplicated event inserted. This continuation is a stress control, not a naturally
  occurring baseline failure and not part of the extraction accuracy denominator.
  The possibility of recovery after longer unresolved cycles remains an explicit limit.
- The first online run encountered slower unaffected controls: do not claim a p95
  improvement from token counts. Use actual interleaved base/candidate measurements
  for subsequent stopping-rule timing conclusions.
- After the first contrast screen: strengths 0.5/1/2 leave the derivation loop's entire
  1,800-token output unchanged (zero control also matches). Before further long
  generations, use fixed-prefix causal next-delimiter probes on both direction
  families at existing strengths and bounded extensions 4/6. The stock first-loop
  continuation margin is 4.375 logits; zero output changes at strength2 motivates
  this extension, rather than importing a strength/layer from the 0.8B model.
  Add a stronger direction control: random output unit vector with the **same v**,
  matching both Frobenius edit norm and perturbation magnitude on every input.
- Coordinator-requested nonlinear arm, frozen before its results: retain the same
  layer30 contrast u/v and test `y' = y - alpha * max(v^T x - 2, 0) * u` on generated-token
  forwards only. Prompt prefill, including the first output-token prediction, is
  unchanged; the sampler enables the intervention after that prediction. This is a
  **context-dependent nonlinear activation adapter**, never a static weight patch or
  exported checkpoint. Threshold2 lies between the derivation first-event projection
  0.044 and second-repetition projection3.744; normal closing is -3.749. Two strengths
  only: 12 and24, motivated by the measured linear third-boundary slope (~0.25 logits
  per strength) and the rectifier's smaller effective projection (5.280-2). No tuning
  on independent prompts. Stop a variant if its causal derivation prefixes still
  prefer repetition at every measured repeated boundary or it changes the derivation
  normal's greedy output. A surviving variant must undergo actual interleaved free
  generation on both loops, the enumeration cap, all six normal controls, and recovery
  controls; compare a random output direction with identical input/gate/scalar norm.
  This branch continues to import the assigned 225f709fd engine/harness snapshot;
  the coordinator's newer repair changes are not adopted mid-experiment.
