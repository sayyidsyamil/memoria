<!-- DRAFT. Not part of the build. Written from the result files by make_ch6_draft.py; remove this block and the note at the end before it goes into the report. -->

> **Draft for Chapter 6, not in the report's build.** Every number is read from a result file by `make_ch6_draft.py`, and `test_ch6_draft.py` recomputes the headline figures from the raw predictions.
>
> **A decision is needed before this goes in.** The report's objectives and research questions (O1 to O3, RQ1 to RQ3) are about the ledger. MemoriaBench tests a different use of the same decisions, checking live statements. Either (a) add it as a fourth objective and question, which changes Chapter 1, Chapter 3, the evidence map (Table 6.1) and Section 6.7; or (b) keep it as an extension subsection and move its claims to the discussion (Section 6.8). Agree this with the supervisor first.
>
> **Numbering.** Chapter 6 already uses Tables 6.1 to 6.19, so the tables below are called N1 to N8 and must be renumbered. A natural place is after Section 6.4.5.

### 6.4.6 Checking live statements against approved decisions (MemoriaBench)

Sections 6.4.2 to 6.4.5 test the ledger by asking it questions. The same approved decisions can also be used while a meeting is running: each new statement is checked against them, and the user is warned if it is **outdated** (it repeats something a later decision replaced) or **contradicts** a decision that is still current. This section tests that check on a new benchmark, MemoriaBench. It uses the same language model as the rest of the chapter (Qwen3.5-4B, 4-bit, greedy decoding) on the same machine (Apple M5, 16 GB). An *alert* is a statement judged OUTDATED or CONTRADICTS; a *false alarm* is an alert on a statement that is neither.

**Data.** MemoriaBench has 336 statements from 28 AMI series. The five development series (ES2003, ES2011, IS1008, TS3004 and TS3006), on which baseline settings were tuned, and the two incomplete series (IS1002 and IS1005) are left out. In each series the history is meetings a to c: the decisions the annotators wrote down, each tied to the moment in the meeting it rests on. Meeting d is never opened. Twelve statements are made per series, two for each of six classes (Table N1), so each class has 56 statements and 112 of the 336 are alerts. The tables call a statement a *probe*.

No language model writes or labels a statement. The generator is a fixed program (same bytes on every run), and each gold label is true by construction. For OUTDATED this needed one compromise. The annotators almost never recorded a changed decision, so only **5** of the 56 OUTDATED statements rest on a decision the annotators recorded as replaced (*real*). For the other **51** the generator gives an active decision a note "(replaces X)", as Memoria's own approval step would, and the statement asserts X (*synthetic*). The model is shown these notes; without them nothing in the memory says that X was ever replaced. Results for OUTDATED are therefore mostly a test of whether a system uses a replacement note it is given, and the 5 real cases are counts, not estimates.

Table N1 The six classes, with one statement of each from series ES2004

| Class | What the statement does | Alert | Example statement | Cited decision |
|---|---|---|---|---|
| SUPPORTED_CURRENT | Restates a decision that is still current | no | The remote will come with a recharging dock. | [ES2004b:30:44] The remote will be bundled with a docking station to recharge the … |
| OUTDATED | Asserts something a later decision replaced | yes | Well, the remote will not have an LCD screen. | [ES2004c:32:41] It was decided that the remote would feature an LCD screen, rubber … (replaces a remote without a screen) |
| CONTRADICTS | Asserts the opposite of a current decision | yes | The remote will not feature Video Plus capabilities. | [ES2004b:27:02] The remote will feature Video Plus capabilities and a seashell-like … |
| UPDATES | Proposes a feature no decision covers | no | Right, why don't we add a one-button movie mode? | none |
| IRRELEVANT | Banter and meeting logistics | no | Could someone close the door, there's a draught. | none |
| INSUFFICIENT_EVIDENCE | Claims a result that no decision can confirm or refute | no | So the usability test showed that people find it easy to learn. | none |

Source: `data/memoria_bench.jsonl` and `data/memoria_bench.provenance.jsonl`, made by `generate_bench.py`.

**Checks on the labels.** The file was fixed by its SHA-256 hash (`8d8f9ca6…4793`) before any system ran, and a test regenerates it from the AMI files and compares the bytes. The labels were also audited by blind language-model labellers that saw only a series' decisions (with the notes) and the class definitions, never the gold labels. Round 1 (GPT-5.5) agreed on 334 of 336 statements and led to changes in the generator. Round 2 (GPT-5.6 Sol), on the revised file, agreed on 336 of 336. Round 3 re-checked the 24 statements of the two series that changed after round 2 (24 of 24). Both labellers are language models and both were shown the synthetic notes. The audit therefore shows that the labels follow the class definitions; it does not show that a person would agree, or that the statements are hard, because they come from templates.

**Systems.** Every system is given the same statements and the same history of meetings a to c, and never a gold label or a citation (Table N2).

Table N2 The systems compared

| System | What it does |
|---|---|
| B0 Closed book | The model gets no memory. A high score on the alert classes would mean that the statements give themselves away, or that the model has seen the AMI meetings. |
| B1 Embeddings | Cosine similarity (bge-small-en-v1.5) of the statement with each decision. An alert is raised when the highest similarity reaches a threshold τ chosen on the development series. B1b cuts the same similarity into three bands. |
| B2 Transcript RAG | The raw words of meetings a to c, cut into chunks of about 90 words (25 words overlap); the 5 nearest chunks are read by the model. No decision list, no replacement notes. |
| M2 Full Memoria | The approved decisions with their replacement notes and a short class guide are read by the model, which answers with a class, one sentence and the decision it cites. |
| A1 M2 without notes | M2 with the "(replaces X)" notes removed: it shows what the notes contribute. |

**Results.** Table N3 gives the results on all statements and Table N4 the paired tests of M2 against each other system. Every system answered the same statements, so each test is paired.

Table N3 Results on MemoriaBench (336 statements, 28 series)

| System | Acc. (%) | Macro-F1 | Alert prec. | Alert rec. | False alarm (%) | P50 (ms) | P95 (ms) | Mem. (GB) |
|:--|--:|--:|--:|--:|--:|--:|--:|--:|
| B0 Closed book | 47.9 | 0.42 [0.38, 0.46] | 0.48 | 0.12 | 6.2 | 1,059 | 1,381 | 3.5 |
| B1 Embeddings, alert if similarity ≥ τ | 31.5 | 0.16 [0.15, 0.16] | 0.58 | 0.94 | 33.9 | **4** | **5** | **0.4** |
| B1b Embeddings, three bands | 37.2 | 0.25 [0.22, 0.28] | 0.66 | 0.90 | 23.7 | **4** | **5** | **0.4** |
| B2 Transcript RAG | 61.6 | 0.62 [0.57, 0.66] | 0.94 | 0.53 | 1.8 | 2,391 | 2,988 | 3.5 |
| M2 Full Memoria (proposed) | **87.2** | **0.87** [0.84, 0.90] | **0.99** | **0.98** | **0.4** | 2,274 | 3,620 | 3.5 |
| A1 M2 without supersession notes | 78.6 | 0.74 [0.71, 0.77] | **0.99** | 0.88 | **0.4** | 2,554 | 3,738 | 3.7 |

Source: `results/table_6_1.csv`, `results/chapter_6_table_1.md`, made by `run_benchmarks.py`, `eval_metrics.py` and `export_thesis_tables.py`. Bold marks the best value in a column (ties are all marked). An alert is a predicted OUTDATED or CONTRADICTS; a false alarm is an alert on a probe that is not one. P50 and P95 are warm, per probe, on an Apple M5 with 16 GB; memory is the peak physical footprint of the process. M2 and A1 read the annotators' decisions, B2 the raw transcript. Brackets: 95% cluster-bootstrap interval, resampling the 28 series.

Table N4 Paired tests of M2 against each other system

| M2 against | Δ Macro-F1 [95% CI] | b / c | McNemar p (Holm) | Series won / lost / tied | Series sign p | Permutation p (series) |
|:--|--:|--:|--:|--:|--:|--:|
| B2 Transcript RAG | +0.25 [+0.22, +0.29] | 55 / 1 | 1.6e-15 (3.2e-15) | 26 / 0 / 2 | 3.0e-08 | ≤ 0.0001 |
| B1 Embeddings, alert if similarity ≥ τ | +0.71 [+0.68, +0.75] | 82 / 2 | 3.7e-22 (1.5e-21) | 28 / 0 / 0 | 7.5e-09 | ≤ 0.0001 |
| B0 Closed book | +0.45 [+0.40, +0.50] | 111 / 1 | 4.4e-32 (2.2e-31) | 28 / 0 / 0 | 7.5e-09 | ≤ 0.0001 |
| B1b Embeddings, three bands | +0.62 [+0.58, +0.66] | 63 / 2 | 1.2e-16 (3.5e-16) | 26 / 0 / 2 | 3.0e-08 | ≤ 0.0001 |
| A1 M2 without supersession notes | +0.13 [+0.10, +0.16] | 12 / 1 | 0.0034 (0.0034) | 10 / 1 / 17 | 0.0117 | ≤ 0.0001 |

Source: `results/stat_tests.json`, made by `stat_tests.py`. Every system answered the same probes. McNemar: exact two-sided test on whether the alert decision was right; b = only M2 right, c = only the other system right; in brackets the Holm-adjusted p over these 5 comparisons. Series: in how many of the 28 series M2 was right on more, fewer, or as many probes; exact sign test. Permutation: Macro-F1 difference, 10,000 resamples that swap the two systems' answers series by series (the smallest p it can give is 1/10,001). Probes of a series share one memory, so the series-level tests are the ones to cite; the probe-level p-values are optimistic. All exploratory.

Full Memoria reaches a Macro-F1 of 0.87 [0.84, 0.90]. Transcript retrieval reaches 0.62 [0.57, 0.66], the closed-book control 0.42 and the two embedding baselines 0.16 and 0.25. The closed-book score is above chance because the classes UPDATES and IRRELEVANT can be recognised from the wording alone (98% and 93% recall), but it finds almost no alert (recall 0.12), which gives no sign that the model has memorised the meetings.

For the warning itself, M2 finds 110 of the 112 alerts (recall 0.98) and raises 1 false alarm among the 224 statements that are not alerts (0.4%); its alert precision is 0.99. The embedding baseline B1 finds 105 alerts too (recall 0.94) but raises a false alarm on 33.9% of the non-alerts, because a statement that restates a decision is as similar to it as one that contradicts it. Transcript retrieval is quiet (4 false alarms) but finds only 59 of 112 alerts (recall 0.53): given raw passages, the model does not know which of two statements about the same thing is the later one.

The paired tests agree. M2 is right on 55 alert decisions where transcript retrieval is wrong, and wrong on 1 where it is right (exact McNemar p = 1.6e-15); M2 is better in 26 of the 28 series and worse in 0 (sign test p = 3.0e-08); the Macro-F1 gain is +0.25 [+0.22, +0.29] and the permutation test over series gives p below 0.001. One difference is **not** significant: M2 raises 1 false alarm and B2 4, which is too few to separate (p = 0.375). The claim is that M2 finds far more of the alerts at a false-alarm rate that is no worse, not that it raises fewer false alarms than retrieval.

Table N5 Recall by gold class on MemoriaBench (336 statements)

| System | Supported | Outdated | ↳ real (5) | ↳ synthetic (51) | Contradicts | Updates | Irrelevant | Insufficient |
|:--|--:|--:|--:|--:|--:|--:|--:|--:|
| B0 Closed book | 19.6 | 8.9 | 0.0 | 9.8 | 0.0 | **98.2** | 92.9 | 67.9 |
| B1 Embeddings, alert if similarity ≥ τ | 0.0 | 0.0 | 0.0 | 0.0 | **91.1** | 0.0 | **98.2** | 0.0 |
| B1b Embeddings, three bands | 39.3 | 0.0 | 0.0 | 0.0 | 85.7 | 0.0 | **98.2** | 0.0 |
| B2 Transcript RAG | 98.2 | 32.1 | 20.0 | 33.3 | 28.6 | 62.5 | 87.5 | 60.7 |
| M2 Full Memoria (proposed) | 98.2 | **71.4** | **80.0** | **70.6** | 82.1 | 96.4 | 91.1 | 83.9 |
| A1 M2 without supersession notes | **100.0** | 5.4 | 0.0 | 5.9 | **91.1** | 94.6 | 92.9 | **87.5** |

Source: `results/per_class.csv`, `results/chapter_6_table_2.md`. Recall by gold class, in percent: how often the class was found among the probes that belong to it. The OUTDATED probes are shown whole and split by what founds them: 5 rest on a decision the annotators replaced, 51 on a synthetic replacement note. Bold marks the best value in a column.

**What the replacement notes do.** Without them (A1) the recall for OUTDATED falls from 71.4% to 5.4%, while the other classes hardly move (Table N5), and Macro-F1 falls from 0.87 to 0.74. This shows that M2 uses a note it is given. It does not show that a model can find a replaced decision unaided, and it does not show that Memoria's approval step will write such notes as well as the generator did: that step is tested in Section 6.4.5. Of the 5 real replacements M2 finds 4, and of the 51 synthetic ones 36.

**The five official test series.** Table N6 repeats the comparison on the 60 statements of the five AMI test series (ES2004, ES2014, IS1009, TS3003 and TS3007), the series the earlier sections of this chapter also use. With 60 statements no interval is meaningful, and the ranking of the systems is the same as on all 336. M2 reaches Macro-F1 0.85, alert recall 1.00 and alert precision 0.95.

Table N6 Results on the five official AMI test series (60 statements)

| System | Acc. (%) | Macro-F1 | Alert prec. | Alert rec. | False alarm (%) | P50 (ms) | P95 (ms) | Mem. (GB) |
|:--|--:|--:|--:|--:|--:|--:|--:|--:|
| B0 Closed book | 50.0 | 0.45 | 0.71 | 0.25 | 5.0 | 1,071 | 1,371 | 3.5 |
| B1 Embeddings, alert if similarity ≥ τ | 31.7 | 0.16 | 0.61 | 0.85 | 27.5 | **4** | **5** | **0.4** |
| B1b Embeddings, three bands | 31.7 | 0.18 | 0.62 | 0.80 | 25.0 | **4** | **5** | **0.4** |
| B2 Transcript RAG | 55.0 | 0.54 | 0.91 | 0.50 | 2.5 | 2,386 | 2,771 | 3.5 |
| M2 Full Memoria (proposed) | **85.0** | **0.85** | 0.95 | **1.00** | 2.5 | 1,860 | 3,234 | 3.5 |
| A1 M2 without supersession notes | 75.0 | 0.69 | **1.00** | 0.85 | **0.0** | 2,447 | 3,585 | 3.7 |

Source: `results/table_6_1.csv`, `results/chapter_6_table_1b.md`. Bold marks the best value in a column (ties are all marked). An alert is a predicted OUTDATED or CONTRADICTS; a false alarm is an alert on a probe that is not one. P50 and P95 are warm, per probe, on an Apple M5 with 16 GB; memory is the peak physical footprint of the process. M2 and A1 read the annotators' decisions, B2 the raw transcript. Point estimates only: 5 series are too few for an interval.

**Time and memory.** In this run M2 took a median of 2.27 s per statement (95th percentile 3.62 s), warm, with a peak footprint of 3.5 GB. The embedding baseline took 4 ms. The report sets no speed target (requirement NFR10), so these are measurements, not a pass against a target. They also vary with what else the machine is doing: the same M2 check on the same statements took a median of 1.56 s in a second full run, and 1.26 s in a third, shorter run (112 statements) that alternated with M3, so one run should be read to about a factor of two.

#### Growing memory and topic scoping

MemoriaBench gives the auditor only the 12 or so decisions of one series. A real memory grows with every meeting, and a full-memory prompt grows with it. A natural remedy is *topic scoping*: show the model only the decisions about the statement's topic. Two questions were asked: does the check get worse as the memory grows, and does a scoped version, M3, prevent that without losing alerts? The plan, the thresholds and the tests were written and hashed before the first test run (`results/scoping/preregistration.json`, written 2026-10-16 00:14:34 +0800).

M3 shows the model the 4 decisions nearest to the statement by embedding similarity (bge-small), plus up to 2 decisions about money or dates when the statement mentions them. The scope size 4 is the smallest from 2 to 6 whose scope held the gold decision for at least 95% of the development statements that have one (29 of 30). The memory was enlarged with decisions of other series: C0 is the series' own memory (12 decisions, median), C1 adds 30 decisions of other series (42) and C2 adds up to 150 (86). The added decisions were filtered by fixed rules so that none shares a key word with the series' decisions or statements; the gold labels therefore stay valid, which a blind audit with the largest memory confirmed (336 of 336 agreed, and none used an added decision). A memory of every other series' decisions, unfiltered, could not be kept label-safe and was not used for the language-model runs.

Table N7 Full memory (M2) and scoped memory (M3) as the memory grows (336 statements)

| Memory | System | Decisions read (median) | Prompt tokens (median) | Macro-F1 [95% CI] | Alert recall | False alarms | Median time, batch run (s) |
|---|---|--:|--:|--:|--:|--:|--:|
| C0 (12) | M2 | 12 | 914 | 0.87 [0.84, 0.90] | 0.98 | 1 | 1.56 |
| C0 (12) | M3 | 4 | 623 | 0.87 [0.84, 0.90] | 0.92 | 4 | 1.36 |
| C1 (42) | M2 | 42 | 1718 | 0.82 [0.78, 0.85] | 0.97 | 1 | 2.44 |
| C1 (42) | M3 | 4 | 604 | 0.78 [0.73, 0.83] | 0.73 | 3 | 1.03 |
| C2 (86) | M2 | 86 | 2906 | 0.77 [0.73, 0.81] | 0.90 | 0 | 3.87 |
| C2 (86) | M3 | 4 | 603 | 0.76 [0.71, 0.81] | 0.66 | 1 | 1.04 |

Source: `results/scoping/scoping_table.csv`, `scoping_results.json`, made by `run_scoping.py` and `scoping_report.py`. The times come from one long batch run in which the machine was also busy with other work, so they are rough; the cleaner comparison is the interleaved one in the text.

**The full memory degrades as it grows.** M2's Macro-F1 falls from 0.87 with 12 decisions to 0.82 with 42 and 0.77 with 86: −0.053 [−0.090, −0.019] and −0.099 [−0.136, −0.061] in a paired bootstrap, both wholly below zero. Alert recall falls from 0.98 to 0.97 and 0.90, while false alarms stay at 1, 1 and 0. Of the 57 statements whose answer changed between C0 and C2, 44 became wrong and 12 became right. Of those that became wrong, 18 were an alert given the other alert class (OUTDATED for CONTRADICTS or the reverse), 8 were alerts that were no longer flagged, and 18 were statements that are not alerts, given another class that is not an alert. The recall for OUTDATED falls from 71% to 55% and for CONTRADICTS from 82% to 62%. The prompt grows from 914 to 2906 tokens, and the model also gets slower: interleaved on 112 statements, M2 took a median of 1.26 s at C0 and 3.78 s at C2, with a 95th percentile of 6.01 s at C2.

**Scoping is faster but loses alerts.** The preregistered test of accuracy passes: at C0 the Macro-F1 of M3 differs from M2 by 0.000 [−0.036, +0.032], and the lower bound is above the margin of −0.05. The alert recall does not hold: it is 0.92 against 0.98 at C0 (−0.062 [−0.116, −0.009]; M3 right and M2 wrong on 2 alert decisions, the reverse on 12; exact McNemar p = 0.013), and 0.73 and 0.66 against 0.97 and 0.90 at C1 and C2. Scoping does not repair the degradation of the full memory either: the Macro-F1 of M3 minus that of M2 is −0.035 [−0.096, +0.019] at C1 and −0.010 [−0.062, +0.037] at C2, so there is no evidence that it helps. The reason is the scope, not the model: the decision a statement was about was inside the scope for 93% of the 168 statements that have one at C0, 77% at C1 and 71% at C2, and of the M3 answers that were wrong although a gold decision existed, the gold decision lay outside the scope in 9 of 10 at C0, 28 of 30 at C1 and 39 of 39 at C2.

What scoping does buy is time. Interleaved with M2 on the same 112 statements, M3 took a median of 0.93 s against 1.26 s at C0 (ratio 0.74 [0.70, 0.79], faster on 94% of the statements) and 0.98 s against 3.78 s at C2 (ratio 0.26), because its prompt does not grow. Naming the topic with the language model was measured and rejected for cost: one call took a median of 327 ms (362 ms at the 95th percentile) against 7 ms for the embedding step.

#### Can a better retriever make the scope safe?

Because the scope, not the model, lost the alerts, the retriever was examined on its own, without any language model. For the 168 statements that have a gold decision the question is whether that decision is among the 8 highest-ranked ones. The rule was written before any embedding was computed: a retriever is *recall-safe* if it reaches 95% at k = 8 on the test series in C2 and in C3 (the series' own decisions plus all the other series' decisions, unfiltered), and only a recall-safe retriever would justify another language-model run. Table N8 gives the main candidates: bge-small (what M3 used), EmbeddingGemma 2 (an open multilingual embedder, run through MLX at several precisions), BM25, and a fusion of dense and BM25 rankings.

Table N8 Share of the 168 statements with a gold decision whose decision is among the 8 highest-ranked (test series)

| Retriever | C0 | C1 | C2 | C3 (unfiltered) | Time per statement | Memory |
|---|--:|--:|--:|--:|--:|--:|
| bge-small, dense | 98% | 83% | 74% | 57% | 3.8 ms | 0.79 GB (CPU) |
| bge-small + BM25 | 100% | 90% | 88% | 67% | 3.8 ms | 0.79 GB (CPU) |
| BM25 | 96% | 89% | 89% | 65% | 0.20 ms | no model |
| EmbeddingGemma 2, bf16, dense | 100% | 91% | 84% | 63% | 8.0 ms | 1.84 GB (Metal) |
| EmbeddingGemma 2, 5-bit, dense | 100% | 91% | 84% | 64% | 8.6 ms | 1.45 GB (Metal) |
| EmbeddingGemma 2, 5-bit + BM25 | 99% | 93% | 90% | 67% | 8.6 ms | 1.45 GB (Metal) |

Source: `results/scoping/bakeoff/bakeoff_results.json`, made by `retriever_bakeoff.py` and `embed_texts.py`. BM25 does well in C1 and C2 because the added decisions were chosen to share no word with the statements; C3 is the fair lexical test. For the combined rows the time is that of the dense step; BM25 adds about 0.2 ms. C3 is a stress test, not a realistic memory: it holds the decisions of the other 27 groups that designed the same product.

**No retriever is recall-safe.** The best of the 23 variants tried reaches 90% in C2 and 69% in C3, below the 95% that was required, so no further language-model run was made and similarity scoping is not safe on this benchmark. EmbeddingGemma 2 is a better dense retriever than bge-small (best dense variant 86% against 74% in C2), and its 5-bit conversion is as good as the 16-bit one at about 1.5 GB of Metal memory, but adding BM25 helps more than changing the embedder, and the gain does not reach the rule. A likely reason (not tested) is that nearly all the decisions share one template ("The remote will …"), so embedding similarity says little about the topic.

**Malay.** Because users in Malaysia often speak Malay or mix it with English, 56 of the statements with a gold decision were also written in Malay and in mixed Malay and English (by the AI assistant, not reviewed by a second Malay speaker, so this is a small sample and not a benchmark) and searched against the English decisions with dense retrieval. With the series' own memory (C0) the gold decision is among the four nearest for 73% of Malay statements with bge-small and 93% with EmbeddingGemma 2 (5-bit); with the larger memory (C2) 34% and 75%. For mixed statements the figures are 95% and 98% at C0 and 80% and 86% at C2, and for the English originals 96% and 100% at C0. An English-only embedder is therefore a poor choice for Malay input, and the multilingual one is a reasonable choice if Malay is to be supported. Whether the auditing model itself checks Malay statements correctly was not tested.

#### Threats to validity for this section

- **Labels.** The statements are made from templates and the labels are true by construction, but they were audited only by two language models, and 51 of the 56 OUTDATED statements depend on a replacement note the generator wrote. No person labelled any statement.
- **Realism.** The statements are clean sentences, not transcribed speech with recognition errors, interruptions or half-finished thoughts, and the history is the annotators' decision summary, not the output of Memoria's own extraction. The result is the accuracy of the check given a correct memory.
- **Memory growth.** The larger memories are made of other series' decisions with every shared word filtered out. A real memory has decisions that touch the same topics, which is harder for the full memory and for any scope. The drop from 0.87 to 0.77 is measured on memories of 12 to 86 decisions and should not be extended past that.
- **Order of work.** The scale experiment and the retriever test were designed after the main benchmark had been read. Each was fixed in writing before its own test runs, but the choice to run them was not blind. A bug in how the cited decision is read from the model's reply (a citation with a suffix could be read as another id) was found after the scale runs and fixed; the labels and reasons were checked to be unchanged, and the code as it ran is kept (`results/memoria_as_run.py`).
- **Settings.** One model, one machine, greedy decoding; the thresholds of B1 and the scope size were chosen on five development series. Timing varies by about a factor of two between sessions.
- **Multiple tests.** The tests in Table N4 are adjusted for the five comparisons (Holm); the tests in the scale experiment are not, and several were run.

#### How to reproduce

```
python3.11 generate_bench.py --verify && python3.11 validate_bench.py      # the benchmark and its hash
python3.11 run_benchmarks.py                                               # B0, B1, B2, M2, A1, one model at a time (Memoria.app closed)
python3.11 eval_metrics.py && python3.11 stat_tests.py && python3.11 export_thesis_tables.py   # Tables N3 to N6
python3.11 run_scoping.py prepare && python3.11 run_scoping.py tune && python3.11 run_scoping.py freeze
python3.11 run_scoping.py run                                              # six conditions, 68 minutes of model time in this study
python3.11 scoping_report.py && python3.11 latency_paired.py --condition C0 --probes 112 && python3.11 scoping_posthoc.py   # Table N7 and the text
python3.11 retriever_bakeoff.py prepare                                    # then embed_texts.py in each embedder's own environment
python3.11 retriever_bakeoff.py analyse && python3.11 bakeoff_malay.py     # Table N8 and the Malay check
```

