# Verified handoff

## Outcome

**No candidate qualified for deployment or final-247 validation.** The final static
structural edit has a genuine **derivation-only** effect: TS3004b.w0 terminates with
natural EOS at 149 tokens, clean raw JSON, against 1,800 tokens for the matched random
output control. The two copies of its sole unresolved event are unchanged. Its matched
normal is unchanged by construction; independent preservation has not been established.

The user closed the bounded study after this final running check. No additional model
jobs, search variants, independent model evaluations or validation runs followed it.

## Executed checks

| Check | Actual result |
|---|---|
| CPU helper suite | **19 tests passed**; final run 0.162 s |
| Fresh unchanged 4B on 9 frozen diagnostic prompts | **9/9 historical response byte matches** |
| Final structural natural EOS | Recorded final ID248046 matches tokenizer `<\|im_end\|>`; no early stop or supplied closure. An initial text-config-only ID248044 assumption was corrected from actual tokenizer metadata |
| Original full-dev replay | 97 cache hits, 0 misses; 26/60 TP, 90/124 QA, current 28/43, 46 wrong writes, 119 proposals |
| Both stopping rules, full-dev cached closed-loop replay | Same extraction/QA/writes/proposals; no later prompt cache misses |
| Incremental parser tests | Escaped strings/braces, chunk boundaries, distinct events sharing quotes, partial JSON, recovery counterexamples |
| Targeted projection numerical check | Zero-strength identity; target quantised arrays unchanged; fp32-reference relative L2 errors 0.000414 and 0.000193 for layer30 arms |
| Direction artifacts | SHA-256, finite vectors, unit norms, sparse support and matched random edit norms pass for all three static families |
| Structural derivation | Zero greedy-prefix mismatches; 133 protected control states; normal protection explicitly identified as imposed |
| Input access audit, fresh process | Exactly 10 allowlisted dev `.chain`/`.ask` opens; directory loader disabled; unapproved opens blocked; historical scores reproduced |
| Frozen-source guard | Five critical engine/harness files match 225f709fd; mismatch test refuses model loading |
| Model process lifetime | All 15 jobs completed via notifications; no owned model worker/wrapper remains |
| Resource bound | Longest model job 331.52 s; largest process footprint 4.99550132 GB; MLX allocator cache 256 MiB |

Tests that document recovery failures are successful **tests of the failure**. They
are not evidence that the corresponding intervention passes its quality gate.

Commands actually used:

```sh
PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/bin/python3.11 -B -m unittest discover \
  -s research/weight-edit-loops -p 'test_*.py' -v
PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/bin/python3.11 -B \
  research/weight-edit-loops/audit_access.py --out input_access_audit_final.json
PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/bin/python3.11 -B \
  research/weight-edit-loops/audit_recovery_limit.py
PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/bin/python3.11 -B \
  research/weight-edit-loops/audit_results.py
```

Audit scripts create new evidence and refuse overwrites. Existing evidence remains
available; a replay should use a fresh output label where supported.

## Exact measured stopping comparison

`conservative-paired.jsonl` interleaves base/conservative (AB/BA) on TS3004b.w0,
TS3006d.w0, TS3006d.w3 and TS3004b.w1. Total generation: 167.0215 → 106.2291 s;
p95: 55.5750 → 49.8887 s. Tokens: 5,458 → 3,344. All stopped raw texts are exact
baseline prefixes; returned JSON adds only closing syntax. The enumeration reply,
the normal reply, all baseline valid/gold candidates and all three late-event anchors
are preserved in this diagnostic. It is not a population-p95 estimate.

The earlier non-interleaved 9-prompt comparison had p95 **65.5428 → 72.0459 s**, despite
fewer tokens. That adverse result is retained; timing drift is not hidden.

The conservative rule remains **research only**: four unresolved duplicates followed
by a real-source grounded LCD event are a constructed recovery counterexample. The
rule loses the later correct event. First-repeat stopping additionally fails a fully
model-generated `[A,A,B]` control, saving time by discarding B.

## Unexecuted / unmet gates

- Final structural edit: independent TS3006 loop and enumeration prompts; the other
  five matched normal prompts; repeat-then-new-event recovery; narrow Ask/guard/router
  probes; broader closed-loop development extraction. **Not run.**
- Its measured matched normal is the derivation normal, protected algebraically, so
  it cannot substitute for those independent checks.
- The nonlinear gate failed its predeclared causal-prefix criterion and was stopped.
  No free-generation or generalisation benefit is asserted for it.
- The layer30 static families failed the derivation-loop screen even at strength6.
- Some prewritten strength/opposite-sign configurations were never executed. The
  layer30 strength2 normal generation was explicitly deferred by the lease. Files
  defining a configuration do not imply an observed result.
- Final-247/new-val model generation or scoring: **none**. Old-test model generation
  or scoring in this study: **none**. No final application integration was performed.

## Data-access and baseline limitations

This branch's `context.load_chain` has used exact individual dev files from its first
commit. The fresh-process I/O audit verifies that path and blocks the coordinator's
broad sibling loader. It does not certify other sessions' historical host parsing,
every byte read from a shared cache, or a project-wide claim that reserved files were
literally never read. The distinction is **no validation generation/scoring**, plus
an audited exact-file replay path here.

The five-file source guard catches critical baseline changes, including a newer
`temporal_service.py`; it is not a complete import/dependency lock. The coordinator
owns historical import pinning and later whole-pipeline alignment. These results use
225f709fd repairs, not newer main number-word fixes.

No shipping engine, model file, parent public documentation or private report was
edited. All changes and evidence are local to `research/weight-edit-loops/`.
