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

## In progress

- Combined app build, native API checks, live queue/reliability verification.
- Tracked-facts setup view now loads in installed app after fixing nested package
  resource mapping. Native fact ingestion/approval and live Ask remain to verify.

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

- 76 Python adapter/engine/product tests passed.
- 67 frontend temporal/meeting integration tests passed in the latest focused run.
- Original engine: 291 tests passed without modifying its source/results.
- TypeScript and scoped lint passed. Hardened native bundle and packaged imports
  pass. Preferred black/white Dock logo is in the new bundle. Native reinstall and
  end-to-end hardened flows still need checking.

## Needs you

- No action presently required. OS permission prompts may block native testing.
- Human UAT and supervisor approval cannot be fabricated or completed automatically.
