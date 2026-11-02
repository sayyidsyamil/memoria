# Memoria

Your meetings decide things. Memoria remembers what was decided, shows the words that prove it, and keeps your meetings on your Mac.

[Download the UAT build](https://github.com/sayyidsyamil/memoria/releases/tag/v0.2.0-uat) · [Developer setup](docs/DEVELOPMENT.md) · [Roadmap](docs/ROADMAP.md) · [Research](research/)

![Native meeting summary with approved outcomes and source timestamps](docs/media/summary.webp)

Native macOS interface, shown with a fictional review fixture.

## The idea: verify once, answer exactly

Meeting tools keep transcripts and summaries. To answer "who is our vendor now?" or "what was the budget on 27 September?", an assistant has to re-read every meeting and work the state out again, at every question. It often gets dates and changes wrong.

Memoria does that work once, when a meeting ends:

1. **Record.** Audio is transcribed on the Mac with speaker labels.
2. **Review.** A local model proposes each decision or commitment with its exact quote. You approve, correct or reject it.
3. **Recall.** Approved values go into a ledger with their history. Questions about now, a past date or the number of changes are answered by lookup, with the quote and the second in the recording.

Because the ledger knows what is decided, it can also flag a contradiction while a meeting is running.

## Does it work?

Measured on real meetings (AMI corpus: 20 test meetings in series, 96 questions), with the same local model (Qwen3.5-4B) for every method:

| | Memoria | Full transcripts in the prompt | Transcript search (BM25) |
|---|---|---|---|
| All questions | **61%** (59/96) | 43% | 39% |
| Value on a past date | **100%** (29/29) | 21% | 48% |
| Number of changes | 36% | 33% | 3% |
| Current value | 53% | **71%** | 65% |
| Time per question | **3.0 s** | 84.2 s | 3.4 s |

- With perfect proposals the ledger answers **96/96**. Its errors come from the model's proposals, which is the step a person reviews. With review: **89%**.
- Not a small-model artefact: with a strong hosted model (DeepSeek V4.1 Flash, public AMI data only) the ledger scores **82/96**, level with that model reading every transcript (81), at 818 instead of 31,337 input tokens per question ([strong-model](research/strong-model/README.md)). Asking the small model "is this really decided?" did not help more than dropping proposals at random ([firmness gate](research/firmness-gate/README.md)): the bottleneck is the extractor, not the ledger.
- The app's Ask answers like the evaluated pipeline: 96/96 on gold facts, 58 of October's 59 on extracted facts ([app parity](research/app-parity/README.md)).
- Live contradiction check on [MemoriaBench](research/memoriabench/): catches **81.3%** of conflicts with **1.3%** false alarms. On an hour of unrelated real speech (852 turns) it raised **no** alert.
- Speech: a 60-minute AMI recording transcribed in 11.6 minutes, WER 13.2% (fillers removed), four speakers kept apart.

Evidence and scripts: [research/](research/), [docs/research/](docs/research/), [model choice](research/model-bakeoff/README.md).

## Install (UAT build, Apple silicon, 16 GB)

The [`v0.2.0-uat`](https://github.com/sayyidsyamil/memoria/releases/tag/v0.2.0-uat) disk image is ad-hoc signed (right-click > Open the first time). It does not yet bundle its Python runtimes and models: on the test Mac they are installed once for every account with `scripts/install-shared-runtime.sh`, and `scripts/uat/memoria-doctor.sh` prints READY when an account can run it. See [Install for another macOS account](docs/GETTING-STARTED.md#install-for-another-macos-account-ac7) and the [release record](docs/RELEASE_RECORD.md).

## Develop

Node.js 22+, pnpm 10, Rust stable; Homebrew Python 3.11 for the local models.

```sh
git clone https://github.com/sayyidsyamil/memoria.git
cd memoria
pnpm install --frozen-lockfile
pnpm dev                     # browser build with a mock bridge
pnpm tauri dev               # native app; model setup in docs/DEVELOPMENT.md
```

To see Memoria's own screens in the browser build against a real vault: `MEMORIA_DEV_VAULT=<vault> VITE_MEMORIA_DEV_BRIDGE=1 pnpm exec vite`.

Tests: Rust 1,233, frontend 6,648, app Python 175 and ledger engine 291, all passing (2 November 2026; [verification](docs/WORKSPACE-PRODUCT-VERIFICATION.md)).

React / TypeScript · Tauri / Rust · Python / MLX · Markdown / SQLite

## What is original

Memoria is an FYP2 project by [Sayyid Syamil](https://github.com/sayyidsyamil) (Universiti Malaya), built on [Tolaria](https://github.com/refactoringhq/tolaria) by Luca Rossi / Refactoring and contributors. The editor, vault, notes and app shell are Tolaria's work. Memoria adds the meeting pipeline, review, the ledger engine and its evaluation, Ask and briefs from tracked facts, the live check and MemoriaBench.

[AGPL-3.0-or-later](LICENSE) · [Third-party notices](NOTICE.md) · Design refinement follows [Unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky, CC BY 4.0.

Branches: `main` is the current app. `fyp2` (tag `v0.1.0-uat`) is the build evaluated in October; `legacy` and `master` keep earlier work.
