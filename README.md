# Memoria

Memoria is a meeting-memory app for Apple-silicon Macs. It transcribes meetings on the Mac, proposes the decisions and commitments it hears with their exact quotes, and keeps the approved ones in a ledger with their history.

[UAT build `v0.3.0-uat`](https://github.com/sayyidsyamil/memoria/releases/tag/v0.3.0-uat) · [Documentation](docs/README.md) · [Roadmap](docs/ROADMAP.md) · [Research](research/)

![Native meeting summary with approved outcomes and source timestamps](docs/media/summary.webp)

Native macOS interface, shown with a fictional review fixture.

## How it works

To answer "who is our vendor now?" or "what was the budget on 27 September?" from transcripts or summaries, an assistant has to re-read the meetings and work out the state again for every question. Memoria does that work once, when a meeting ends:

1. **Record.** Audio is transcribed on the Mac with speaker labels.
2. **Review.** A local model proposes each decision or commitment with its exact quote. You approve, correct or reject it.
3. **Recall.** Approved values go into a ledger with their history. Questions about the current value, a past date or the number of changes are answered by lookup, with the quote and its time in the recording.

During a meeting, a sentence that contradicts an approved decision raises a cue.

## Results

AMI meeting corpus: 20 test meetings from five series, 96 questions, the same local model (Qwen3.5-4B) for every method ([October evaluation](research/ledger-engine/results/ami/ami_test_report.md)):

| | Memoria | Full transcripts in the prompt | Transcript search (BM25) |
|---|---|---|---|
| All questions | **61%** (59/96) | 43% (41/96) | 39% (37/96) |
| Value on a past date | **100%** (29/29) | 21% (6/29) | 48% (14/29) |
| Number of changes | 36% (12/33) | 33% (11/33) | 3% (1/33) |
| Current value | 53% (18/34) | **71%** (24/34) | 65% (22/34) |
| Time per question | **3.0 s** | 84.2 s | 3.4 s |

- With gold facts the ledger answers 96/96, so its errors come from the model's proposals, the step a person reviews. With a simulated perfect reviewer: 85/96 (89%).
- With a strong hosted model (DeepSeek V4.1 Flash, public AMI data only) the ledger scores 82/96, level with that model reading every transcript (81/96), at 818 instead of 31,337 input tokens per question ([strong model](research/strong-model/README.md)). Asking the 4B model "is this really decided?" did no better than dropping the same number of proposals at random ([firmness gate](research/firmness-gate/README.md)): the limit is extraction, not the ledger.
- The app's Ask matches the evaluated pipeline: 96/96 with gold facts, and 58/96 with extracted facts where October scored 59/96 ([app parity](research/app-parity/README.md)).
- Live contradiction check on the [MemoriaBench](research/memoriabench/) test split: 98/112 conflicts caught (87.5%), 2/224 false alarms (0.9%), 0.26 s per sentence (median). Spoken by six synthetic voices as 28 meetings and captioned live: the same 98/112, cue 1.26 s after the sentence (median). No alert on an hour of unrelated real meeting speech ([live verifier](research/live-verifier/README.md)).
- In the installed app, two scripted meetings fed in real time: sentences committed 0.45–2.1 s after they ended, contradictions cued 0.46–1.15 s after the statement when its item was heard correctly, no false alarm ([live speech](research/live-speech/README.md)).
- Speech: Parakeet Ultra with Nemotron 3 Diarization transcribes a 60-minute AMI recording in 113 s, WER 14.4% (fillers removed), with 97.4% of labelled words on the right speaker; as live captions, WER 15.2% and 97.8% ([live speech](research/live-speech/README.md)).

Scripts and data: [research/](research/); choice of model: [bake-off](research/model-bakeoff/README.md).

## Install (UAT build, Apple silicon, 16 GB)

The [`v0.3.0-uat`](https://github.com/sayyidsyamil/memoria/releases/tag/v0.3.0-uat) disk image is ad-hoc signed: open it with right-click > Open the first time. It does not bundle its Python runtimes or models. On the test Mac they are installed once for all accounts with `scripts/install-shared-runtime.sh`, and `scripts/uat/memoria-doctor.sh` prints READY when an account can run the app. See [Install for another macOS account](docs/GETTING-STARTED.md#install-for-another-macos-account-ac7) and the [release record](docs/RELEASE_RECORD.md).

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

Tests (3 November 2026, before the `v0.3.0-uat` build): Rust 1,234, frontend 6,769 and app Python 214, all passing ([verification](docs/WORKSPACE-PRODUCT-VERIFICATION.md)); ledger engine 291, all passing on 2 November ([research](research/README.md)).

React / TypeScript · Tauri / Rust · Python / MLX · Markdown / SQLite

## What is original

Memoria is an FYP2 project by [Sayyid Syamil](https://github.com/sayyidsyamil) (Universiti Malaya), built on [Tolaria](https://github.com/refactoringhq/tolaria) by Luca Rossi / Refactoring and contributors. The editor, vault, notes and app shell are Tolaria's work. Memoria adds the meeting pipeline, review, the ledger engine and its evaluation, Ask and briefs from tracked facts, the live check and MemoriaBench.

[AGPL-3.0-or-later](LICENSE) · [Third-party notices](NOTICE.md) · Design refinement follows [Unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky, CC BY 4.0.

Branches: `main` is the current app. `fyp2` (tag `v0.1.0-uat`) is the build evaluated in October; `legacy` and `master` keep earlier work.
