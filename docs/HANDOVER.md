# Memoria wake-up handover

Status: temporal integration milestone implemented and hardened; verification continues.
See [WORK-LOG.md](WORK-LOG.md) for detail. This is not a completed eight-hour run.

## Done

- Established the current GitHub source baseline and durable log.
- Preserved the original 22-file FYP engine and connected workspace temporal APIs.
- Added explicit tracked-item setup, proposal approval/rejection, history,
  corrections/retractions, current/past/change-count query UI.
- Reviewed-meeting ingestion uses saved dates, speaker labels, and audio offsets.
- Added opt-in live evidence-check adapter and recording HUD evidence cues.
- Live Ask UI added; session text is excluded from generation and answer statements
  must have exact/normalized support in cited approved quotes. Unsupported paraphrases
  fail closed. This limitation is deliberate until reference resolution is validated.
- Drafted a compact report supplement and research evidence inventory.
- Original deterministic engine suite: 291 passed; source/results unchanged.
- Public AMI 60-second file transcription smoke: 14 segments in 17.651 seconds.
  This is file throughput, not measured live caption latency; no WER claimed.
- Three model-only paced public-audio replays completed with 240/240 ACKs each.
  Kept 4s cadence after 2s experiment increased backpressure; see
  [cadence evidence](research/PUBLIC-STREAMING-CADENCE.md).
- Trimmed captions preserve raw timing, visibly label unresolved text alignment,
  and cannot enter temporal ingestion until refined. Empty captions no longer emit.

## In progress

- Latest bundle installed; native setup, real-Qwen extraction, approval, current/past/
  change-count queries and restart persistence passed in a disposable fictional vault.
  See [native check](research/NATIVE-INTEGRATED-CHECK.md). Live flows remain pending.

- Combined app build, native API checks, live queue/reliability verification.
- Tracked-facts setup view now loads in installed app after fixing nested package
   resource mapping. Native fact ingestion/approval now passed; live Ask remains to verify.

## Not yet verified

- Combined live assistant, public-data pipeline evaluation, native integrated flow.
- Full end-to-end live latency and combined application evaluation scores.
- Final-turn live checks, native live Ask, full recording queue behaviour, and UAT.

## Defects found and fixed

- Nested engine packaging/import failure.
- Failed extraction consuming meeting IDs before retry.
- Temporal-storage symlink escape.
- Future-effective facts incorrectly used as current.
- Corrected-value cues using contradictory inherited quotes.
- Permissive IDs/query parameters and unrealistic frontend history contracts.
- Session claims passing with unrelated approved citation IDs.
- Live-check jobs lacking cancellation and no-data feedback.

## Latest verified development checks

- 77 Python adapter/engine/product tests passed; separate speech/transport-related
  focused suite: 20 passed (overlapping coverage; totals are not additive).
- 68 frontend temporal/meeting integration tests passed in the latest focused run.
- Original engine: 291 tests passed without modifying its source/results.
- TypeScript and scoped lint passed. Hardened native bundle and packaged imports
  pass; latest timing-patched bundle is 103.81 MiB, with packaged adapter bytes
  verified against source. Preferred black/white Dock logo is in the new bundle. Native reinstall and
  end-to-end hardened flows still need checking.

## Needs you

- No action presently required. OS permission prompts may block native testing.
- Human UAT and supervisor approval cannot be fabricated or completed automatically.
