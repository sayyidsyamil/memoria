# Narrow strength-2 qualification amendment

Frozen before new model calls, 3 November 2026. This follow-up is separate from the
accepted research-only snapshot **42ad04c4489e48a4b83a36fb26e4657ce7d79fae**. No file in
that snapshot is rewritten. The old `MANIFEST.json` remains the dated archive manifest;
verification here checks its listed files while allowing this new subfolder.

## Exactly one fixed edit

- Existing layer31 static structural edit, **strength2 only**. Strength4 remains
  derivation-only. No new vectors, neurons, seeds, strengths, gates or thresholds.
- Artifact: `../directions/structural_layer31.npz`, SHA-256
  `d4bebbd2f5a839a1a488fee382bf799d6af1dbedc9e0db4eaef29dd832a7f7a8`.
- u SHA-256: `af019fa68394a854c47090f7ee347b180feeaaaccd0fa6ae03877844a8cb954f`.
- v SHA-256: `0ed034886a31fdcffc2d856e6da122db88efb924b4a2bbc7182afb0403b681a7`.
- Edit config: `../directions/structural_layer31_s2.json`; control is the existing
  `../directions/structural_layer31_random_output_s2.json`. The control uses the same
  v, support, strength and per-input perturbation norm, with the pre-existing random u.
  Exact config/vector/control hashes are frozen in `frozen.json` before inference.
- Same cached 4-bit4B at32f3e8ecf65426fc3306969496342d504bfa13f3; greedy, thinking off,
  budget1800. This is the original Q4-base-plus-FP32-linear-residual path, not a new
  checkpoint or the rejected nonlinear adapter.

## First lease: decisive independent transfer check

The only independently frozen **literal** loop is **TS3006d.w0**, prompt SHA-256
`f1191c23264ea69ad461afff49b3801f87d6e3e9210d41799b32d3f2fc14a6e5`.
TS3004b.w0 derived the edit and is not independent. TS3006d.w3 is a distinct-event
enumeration overrun, reserved for the conditional next stage.

Order is **base-before, fixed edit, existing random control, base-after** in one
short exclusive lease. Each condition gets fresh KV/recurrent state; clear both
`model_server._prefix` and `_meeting` before/after each transition. Restore the exact
base module between conditions. No online stop rule and no supplied JSON closure.

### Transfer gates — all required

1. Both unchanged controls reproduce the archived prompt/reply bytes and the capped
   failure. The final base is also the restoration check.
2. Edit naturally reaches tokenizer EOS before1800, returns a nonempty `events`
   object as strict raw JSON, and has no caller-added text or early termination.
3. Preserve all baseline valid/gold candidates and the six source-supported baseline
   controls frozen below. They close the loophole that this reply has zero valid
   writes because everything was labelled unresolved. Confidence/unresolved flags
   may change, but each source-supported item/value and its evidence must survive.
   Report *every* unique parsed/source-grounded candidate loss, including unsupported
   or tentative baseline entries; do not treat mere grounding as correctness.
4. No increase in valid candidates disagreeing with the frozen gold value in force
   at the end of the meeting (the original audit's wrong-value convention, here
   explicitly a pre-merge per-window check).
5. Edit uses fewer tokens than the capped bases and less wall time than **both**
   bracketing bases. These are descriptive n=1 transfer measurements, not a population
   p95/significance claim. If the random control also passes completion and preservation
   and improves latency, the edit must strictly beat it in tokens and time; otherwise
   the effect is not distinguished from the matched control.

The source controls are the five configuration statements at turn8 (buttons, LCD,
speech, advanced chip, kinetic energy), plus the explicit single-curve decision at
turn23. The baseline contains all six but marks them unresolved. Tentative/wrong
hand-dynamo and unrelated case-curve assignments are audited, not promoted to gold.
These controls are evaluation-only and never supplied to the model or adapter.

**If any real transfer/preservation/control gate fails, stop this path.** Complete
the planned first-lease controls, retain all evidence, and run no full qualification.
No switching to strength4 or modifying this amendment after independent results.

## Conditional remaining qualification (only after transfer passes)

Use only the same fixed edit and frozen baseline. Interleave unchanged/edit calls;
include the existing matched control as needed to attribute an apparent gain. Target
at most two further <=8-minute leases, releasing all model processes between leases.

- All six existing nonempty normal controls, including the explicitly non-independent
  derivation normal; plus TS3006d.w3's enumeration overrun and all three pre-frozen
  later-event anchors. Preserve each baseline correct/source-supported event and
  chronology; raw JSON/EOS and source audit precede any latency claim.
- Existing fully generated strict-root `[A,A,B]` and forced-prefix extraction recovery
  controls. Also actually generate the long `[U,U,U,U,B]` source-grounded recovery
  case that falsified conservative stopping; include forced-prefix recovery from that
  long unresolved cycle. Preserve baseline-correct later B, not merely JSON syntax.
- Existing13 narrow Ask/guard/router probes, unchanged vs fixed edit, and explicit
  restoration checks. No guard threshold or answer-scoring adjustment.
- Apply the original preregistered dev/preservation gates without relaxation. A real
  collateral failure ends qualification. Passing this limited development screen
  could label only a **DEVELOPMENT candidate**, never authorise shipping or new-val.

## Baseline and access identity

Keep the as-run225f709fd source snapshot and the five critical hashes in the archived
`frozen_source_check.json`; preserve the accepted f45/v0.3.1 application baseline.
This follow-up does **not** import the coordinator's newerac5e7d29d harness or current
main repairs. Existing full-prompt/cache hashes and actual module paths are recorded.
Use the owned exact-file loader. No old-test/new-val generation/scoring or new-val
source data is used. The prior ten-file I/O audit remains untouched.

Every model job uses the supplied `run-exclusive.py` lock, cache256MiB, local weights,
and the bounded existing runtime. No training, full-model dequantisation, downloads,
paid calls, extra agents, shipping edits, public documentation or private report edits.
