# Long-meeting check (roadmap M2)

Scripts and results of the 60-minute end-to-end check reported in
[docs/research/M2-MEETING-INTELLIGENCE.md](../../docs/research/M2-MEETING-INTELLIGENCE.md).

## Data

AMI Meeting Corpus (CC BY 4.0, <https://groups.inf.ed.ac.uk/ami/corpus/>): `ES2004b.wav`,
`ES2004c.wav` (mixed headset, 16 kHz mono) and the manual `words/` and `segments/` annotations
of both meetings, placed under `ami/audio` and `ami/annotations` next to these scripts. The
audio and annotations are not committed.

## Steps

| Script | What it does |
|---|---|
| `build_fixture.py` | Joins ES2004b and the start of ES2004c into exactly 60:00 (`es2004-60.wav`, and `original.webm` as Opus 48 kb/s like the app's recordings); writes `reference.json`, the AMI words of all four participants on the fixture clock |
| `seed_vault.py` | Creates a disposable vault with the recording as an unreviewed meeting and the ES2004 tracked items from `research/ledger-engine/data/ami_v0/ES2004.chain`, through the app's own meeting and tracked-fact APIs |
| *(app)* | Meetings → Review transcript → Create transcript; `watch_transcription.sh` logs the progress (run 1) |
| `evaluate_transcript.py` | WER against `reference.json` (research normalisation), coverage per five minutes, local error at each part boundary against mid-part controls, speaker purity |
| `collect_parts.py`, `compare_joins.py` | Decode each five-minute part alone through the app's speech worker, then join the same parts with the first and the fixed joining |
| `save_reviewed.py` | Saves the draft as a reviewed transcript exactly as the review screen does |
| `run_extraction.sh`, `evaluate_extraction.py` | Builds knowledge and tracked facts through the app's `engine.py` requests and resident workers, then reports where in the hour the evidence comes from |

## Results

- `results/transcript-eval-run1.json`, `results/transcript-eval-run2.json`: the two native
  transcriptions (first build; fixed joining).
- `results/joins.json`: one decoding of the 13 parts joined three ways (A first build, B shipped,
  C shipped plus elimination).
- `results/extraction-eval.json`: knowledge suggestions per ten minutes for the rejected and the
  final build, and the tracked-fact proposals with their evidence times.
