# Threshold experiment: STREAM_MIN_SECONDS = 10 s (not adopted)

On 14 Oct 2026 the app's finalize path was re-run with the switch point between the one-shot and the streaming diarization lowered from 120 s to 10 s (`stream_min_10s.patch`).
Files here: the full check (`app_path_check_threshold10.md/json`), the one-shot versus streaming comparison on AMI clips of 10 to 120 s (`compare_oneshot_vs_stream.json`), the transcript of the 104 s demo recording produced by the streaming path (`demo_3_stream_final_event.json`) and the driver log.

Result: on 15 AMI clips per length the pooled DER was lower with streaming at every length (11.2 points at 60 s, CI 3.3 to 20.5; 7.0 points at 90 s, CI 1.4 to 13.1; the intervals of the other lengths include zero). On the 104 s demo recording the streaming path was worse (DER 35.8% against 31.0%) and cut the turns into 17 fragments instead of 9.

Decision: the app keeps 120 s, the value the whole evaluation and the release were run with. Lowering it is listed as future work (Chapter 6.4.1 and 7.5). The code and the results of the evaluated build are those in the parent folder.
