# Fixed strength-2 qualification — failed collateral gate

**Final outcome: FAILED COLLATERAL. No DEVELOPMENT candidate, shipping change, or
reserved-247 validation. The fixed path is closed under its preregistered criterion.**

This is the narrow follow-up to the accepted `42ad04c4489e48a4b83a36fb26e4657ce7d79fae`
research snapshot. Its 150 archived files and original manifest are preserved byte for
byte. The amendment, strength, vectors, control, prompt and gates were committed in
`64829416d` **before** the model run. No strength4 switch or further search occurred.

## Independent free-generation result

Prompt: **TS3006d.w0**, the single independent literal loop already frozen in the study.
Exact prompt SHA-256: `f1191c23264ea69ad461afff49b3801f87d6e3e9210d41799b32d3f2fc14a6e5`.

One exclusive lease, order **base → fixed edit → matched random → restored base**:

| Condition | Tokens | Wall time | Natural EOS | Strict raw JSON | Frozen source checks kept |
|---|---:|---:|---|---|---:|
| Base before | 1,800 | 42.4306 s | No: token cap | No | 6/6 |
| **Fixed layer 31 edit, strength 2** | **145** | **6.3730 s** | **Yes** | **Yes** | **2/6 — FAIL** |
| Existing matched random-output control, strength 2 | 1,800 | 44.2416 s | No: token cap | No | 6/6 |
| Restored base after | 1,800 | 60.6628 s | No: token cap | No | 6/6 |

Both base runs and the random control reproduce the archived baseline **bytes and
token IDs exactly**. All calls use fresh KV/recurrent caches and clear both worker
shared caches at transitions. The edit has no online stop rule or added closing text:
its early EOS and syntactically clean raw JSON are genuine.

Nevertheless, it closes after only the first **two distinct events**, buttons and LCD,
which share the same turn8 quote. Its reply contains **no exact repeated event**. The
archived baseline's first exact repetition begins much later, at character 3971.

### Decisive source/event loss

Four controls fixed before inference disappear as structured event records:

| Lost entry | Source evidence |
|---|---|
| Advanced chip | Turn8: “one advanced chip-on-print” |
| Speech included | Turn8: “a uh sensor, that's for the speech” |
| Kinetic energy | Turn8: “Uh we use kinetic energy.” |
| **Single-curved case decision** | Turn23: “we'll have to go for single curve then”; turn25 continues “we can keep it single curved” |

The first three facts' words remain inside the retained full turn8 quote, but their
separate item/value records are absent. The later turn23 decision and its quote are
absent entirely. This fails the source-preservation/chronology gate.

Unique parsed candidates fall **16→2**, and quote-grounded semantic cores **15→2**.
Not all omitted candidates were correct: several baseline entries are tentative or
misattributed. The decisive failure is the **four prespecified source-supported checks**,
especially the later shape decision—not a claim that all 14 omissions are correct facts.

All conditions have **zero valid ledger candidates and zero gold hits**, because the
model marks entries unresolved. Those coarse counts alone would falsely suggest no
loss. The source checks expose the collateral damage.

The bracketing base timings also show substantial drift (42.43→60.66 s). These are
descriptive measurements on one independent prompt, not population-p95 or significance
claims. The shorter edited response is not an acceptable latency improvement because
it omits the required events.

## Qualification gates actually completed

- Independent literal loop: **executed; preservation failed**.
- Matched random control: **executed**, same input vector/support/strength and per-input
  perturbation norm, using the existing random unit output direction.
- Restore check: **executed**; after both interventions the base reproduces historical
  output bytes and token IDs.
- Strict raw JSON, tokenizer EOS, nonempty output, source controls, unique candidates,
  pre-merge gold/valid/wrong-value checks: **audited**. No synthetic closure.

**Not run after the real failure:** all six normal prompts, the distinct-event enumeration
overrun, generated/forced-prefix recovery (including the long unresolved-cycle case),
the 13 narrow Ask/guard/router probes, and their cross-task restore checks. The archived
derivation-normal result is not independent normal qualification. Ordinary load warm-up
scores are not guard qualification.

Only **one** of the proposed <=3 short model leases was used. The planned random and
restored-base controls were completed within that lease. No subsequent model lease,
qualification case or parameter change followed it. The first-repeat and conservative
stopping prototypes retain their earlier research-only status and recovery failures.

## Fixed identities and checks

- Model: `mlx-community/Qwen3.5-4B-MLX-4bit` at
  `32f3e8ecf65426fc3306969496342d504bfa13f3`; greedy, thinking off, max 1,800.
- Edit/control: the existing strength 2 configs and `structural_layer31.npz` with SHA-256
  `d4bebbd2f5a839a1a488fee382bf799d6af1dbedc9e0db4eaef29dd832a7f7a8`.
  Coefficient Frobenius norm is 0.85575968 for both; all hashes are in `frozen.json`.
- Historical source snapshot 225f709fd; model server, temporal service and pipeline
  match f45bbe549 exactly. No current-main word repair or newer coordinator harness was
  imported. Recorded harness SHA-256 remains
  `7cf4dcd07f69187e0d0c893a9ec4c2e03e3ffe1b0b7696e6554d0350e8f3465d`.
- Original coordinator cache SHA-256:
  `e2d7f6eecf960f69f4399ab3b30749c95a7ac683ce8ae76c0095b61fb3a968a9`.
  Owned cache snapshot SHA-256:
  `bddfabda0f6f528ac79c1c34be0e1ca3e3c916eab80b7731d2952e376ad2ad7a`.
- Fresh-process input audit: four allowed opens of **two distinct dev files**, TS3006.chain
  and TS3006.ask, with all other chain/question opens denied and directory loaders
  disabled. This verifies our path; it does not certify other sessions' historical host
  parsing. No new-val data generation/scoring occurred.
- **6 qualification helper/regression tests pass**, including the actual observed
  source-loss case. Passing these tests confirms the gate rejects the bad intervention.
- One completed lease: **169.27 s**; peak process footprint **4.964863216 GB**, peak MLX
  allocation **3.9889 GB**, allocator cache 256 MiB. Source/code/plan hashes and archive
  integrity checks pass. No owned model process is retained.

## Evidence and checkpoint correction

- `AMENDMENT.md`, `frozen.json`: immutable pre-call freeze.
- `results/transfer.jsonl`: all four actual responses, token IDs, timings and audits.
- `results/transfer_audit.json`: paired controls and exact losses.
- `results/source_audit_verdict.json`: decisive source/chronology evidence and final verdict.
- `results/input_audit.json`, `results/closeout_checks.json`: access and lifecycle checks.
- `QUALIFICATION_MANIFEST.json`: hashes of **only this follow-up**, separate from the
  original archive manifest.
- `CHECKPOINT_CORRECTION.md`: corrects the old snapshot's “the user closed” wording.
  The earlier bounded checkpoint was coordinating-assistant-directed; the user had
  requested continuation. Historical measurements and documents were not rewritten.

Model work is complete. CPU checks can be reproduced with:

```sh
PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/bin/python3.11 -B -m unittest discover \
  -s research/weight-edit-loops/qualification-20261103 -p 'test_*.py' -v
```

The original archive should be verified through `qual_common.verify_archive()` here,
or in a detached 42ad04c checkout. Its original strict whole-directory manifest checker
intentionally predates this new qualification subfolder.
