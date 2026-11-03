# Targeted repair of Qwen3.5-4B JSON loops

**Status: experiments in progress; no deployment candidate selected.** All model work
uses the existing pinned 4-bit MLX 4B, thinking off, greedy, 1,800 tokens. This directory
contains research-only opt-in modules; the shipping model and engine are untouched.

## First decisive measurements

Nine frozen development windows: two literal repetition failures, one distinct-event
enumeration overrun, and six nonempty normal controls. All nine fresh baseline outputs
match the historical coordinator cache **byte for byte**.

| Actual inference, same 9 prompts | Repetitive caps | All caps | Returned unclean | Tokens | Generation s | Diagnostic p95 s | Normal byte equality |
|---|---:|---:|---:|---:|---:|---:|---:|
| Unchanged 4B | 2 | 3 | 3 | 9,058 | 321.27 | 65.54 | 6/6 |
| Stop at first completed exact duplicate | 0 | 1 | 1 | 6,670 | 308.92 | 72.05 | 6/6 |

These are real online timings, including detector/iterator shutdown. The first-repeat
rule stops the two loops at 147 and 1,065 emitted tokens; the remaining capped reply
contains **distinct** events and remains unchanged. This first timing pair **does not
show a p95 win**: unaffected outputs ran more slowly in the second lease. Interleaved
controls are required before attributing a latency change to an intervention.

First-repeat stopping also fails the required recovery control `[A,A,B]`: it discards
the distinct correct event B. Its apparently perfect preservation on these 97 cached
windows is insufficient for recommending a general stopping rule. Actual generated
recovery controls and a more conservative unresolved-cycle rule are recorded separately.

### Preservation scope

- Full **97-window offline audit**: only the two literal loops trigger; no distinct
  valid grounded candidate or baseline gold event is removed.
- Full **closed-loop cached** replay after the first-repeat rule: 97 hits / 0 misses;
  TP 26/60, QA 90/124, current 28/43, wrong writes 46, review proposals 119, unchanged.
- Raw generated JSON is retained separately from the rule's added closing `]}`. The
  rule improves returned syntax; it does not turn raw truncation into natural EOS.
- Per-window `gold_hits` in diagnostic files precedes cross-window deduplication.
  It is **candidate coverage, not pipeline TP**. Grounding alone is not correctness.

## Weight hypotheses

Only TS3004b.w0 (loop) and TS3004b.w1 (matched normal) derive directions. Teacher forcing
uses the exact fresh-baseline token IDs, normal 2,048-token prefill, fresh recurrent/KV
caches, and has **zero greedy-token mismatches** on the observed prefixes.

All 32 MLP-down layers were observed at four positions before event closure. Layer 30
had the largest positive direct-logit attribution toward the continuation delimiter
`},{"` versus normal `}` both for loop-minus-normal and later-minus-first repetition.
This is a hypothesis for intervention, not causal evidence by itself.

| Family | Actual 4B selection | Unit-strength edit / projection Frobenius norm |
|---|---|---:|
| `contrast` | Layer 30, loop-minus-normal output direction, all 9,216 input columns | 2.878% |
| `repeat64` | Layer 30, third-minus-first repeated event direction, 64 largest contrastive neuron contributions | 1.198% |

Both implement `W' = W - strength * u vᵀ`, with `v = Wᵀu` restricted to selected
columns when applicable. The original quantised matrix remains the base matmul; a
float32 rank-one residual is added at runtime and cast back to the original output
dtype. This is a **weight-equivalent runtime edit**, not a requantised checkpoint.
Its inference overhead is included. Only one projection at a time is dequantised
when deriving a vector; the full model is never dequantised.

Strengths 0/0.5/1/2, opposite sign, and seeded random output directions with the same
support and exactly matched Frobenius edit norms are specified in `directions/`.
Direction and artifact SHA-256 hashes are in each specification. Independent TS3006
failures, other-series normals, and narrow Ask/guard probes are held out of derivation.

## Reproduce / inspect

- [`PROTOCOL.md`](PROTOCOL.md): selection, margins, amendments and resource limits.
- [`WORKLOG.md`](WORKLOG.md): successes, failures and reasons for revisions.
- `data/diagnostics.json`: frozen IDs, roles, source revision and hashes.
- `data/dev_prompts.jsonl`: full reconstructed dev prompts plus original responses.
- `results/*.jsonl`: every measured prediction, actual token IDs, wall time and parse/
  grounding checks. `.meta.json` records exact runtime/config/source hashes; `.log`
  includes `/usr/bin/time -l` process footprint (baseline 4.980 GB, first stop 4.772 GB).
- `stop_rule.py`: standalone streaming experiment. Default first-repeat is a negative
  recovery control. `conservative()` requires three consecutive unresolved repeats;
  valid repeats never trigger it, but a longer unresolved cycle could still recover.
- `weight_patch.py`: opt-in in-memory projection wrapper with restoration callback.
- `run_recovery.py`: real JSON-copy and forced-prefix-continuation recovery controls
  based on two distinct decisions explicitly stated in TS3006b turn107. These are
  stress controls, not naturally occurring baseline extraction successes.

CPU checks (no model):

```sh
PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/bin/python3.11 -B -m unittest discover \
  -s research/weight-edit-loops -p 'test_*.py' -v
```

Every model command must be wrapped as follows (use a **new** label; outputs never
overwrite earlier evidence):

```sh
PYTHONDONTWRITEBYTECODE=1 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
  /opt/homebrew/bin/python3.11 \
  /private/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode/run-exclusive.py \
  /usr/bin/time -l /Users/Shared/Memoria/runtime/speech/bin/python -B \
  research/weight-edit-loops/run_generation.py --label NEW-LABEL --condition base
```

The runner refuses resident/user-model conflicts, caps MLX allocator cache at 256 MiB,
uses fresh request caches, resets `model_server._prefix` and `_meeting`, and exits all
weights before releasing the external lease. No reserved validation/test data is read.
