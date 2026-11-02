**Paired tests of M2 against each other system**

| M2 against | Δ Macro-F1 [95% CI] | b / c | McNemar p (Holm) | Series won / lost / tied | Series sign p | Permutation p (series) |
|:--|--:|--:|--:|--:|--:|--:|
| B2 Transcript RAG | +0.25 [+0.22, +0.29] | 55 / 1 | 1.6e-15 (3.2e-15) | 26 / 0 / 2 | 3.0e-08 | ≤ 0.0001 |
| B1 Embeddings, alert if similarity ≥ τ | +0.71 [+0.68, +0.75] | 82 / 2 | 3.7e-22 (1.5e-21) | 28 / 0 / 0 | 7.5e-09 | ≤ 0.0001 |
| B0 Closed book | +0.45 [+0.40, +0.50] | 111 / 1 | 4.4e-32 (2.2e-31) | 28 / 0 / 0 | 7.5e-09 | ≤ 0.0001 |
| B1b Embeddings, three bands | +0.62 [+0.58, +0.66] | 63 / 2 | 1.2e-16 (3.5e-16) | 26 / 0 / 2 | 3.0e-08 | ≤ 0.0001 |
| A1 M2 without supersession notes | +0.13 [+0.10, +0.16] | 12 / 1 | 0.0034 (0.0034) | 10 / 1 / 17 | 0.0117 | ≤ 0.0001 |

Every system answered the same probes. McNemar: exact two-sided test on whether the alert decision was right; b = only M2 right, c = only the other system right; in brackets the Holm-adjusted p over these 5 comparisons. Series: in how many of the 28 series M2 was right on more, fewer, or as many probes; exact sign test. Permutation: Macro-F1 difference, 10,000 resamples that swap the two systems' answers series by series (the smallest p it can give is 1/10,001). Probes of a series share one memory, so the series-level tests are the ones to cite; the probe-level p-values are optimistic. All exploratory.
