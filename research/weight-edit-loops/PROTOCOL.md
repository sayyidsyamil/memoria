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
