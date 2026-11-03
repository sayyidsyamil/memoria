# Call audio: acceptance test

Call audio records what this Mac plays (the other side of a call) into the meeting's recording and live captions.
These steps check it in the bundled app. About 20 minutes. Use headphones throughout unless a step says otherwise.

**Run on 3 November 2026** (test build of `call-audio` merged with `main`, MacBook Air, speakers, microphone input set
to 0 so that only the tap could be heard): steps 1, 2 and the end of 7 passed. The test meeting played on the Mac was
captioned, both contradictions were cued, the saved recording holds it at −24.5 dBFS, and the helper exited at End. No
permission prompt appeared (this Mac had answered it before). In the next meeting Call audio started on, as left,
and turning it off mid-meeting stopped the helper (part of step 4). Steps 3, 5 and 6 are still to be run.

## 0. Before you start

- **Last night's prompt.** If a macOS prompt asks whether **node** or **memoria-call-audio** may record audio from other
  apps or this computer, it came from last night's shell tests (the helper run outside Memoria). Choose **Don't Allow**.
  Memoria's own prompt may be queued behind it. An entry for either in the System Audio Recording Only list (below)
  can be removed.
- **Sound.** The Mac's output was muted at volume 0 last night (the tests did not change it). Unmute it.
- **Prebuilt.** A debug bundle of this branch (merged with `main` at `173e987`, so it has everything in
  `v0.3.0-uat`, the noise fix of `main` and call audio) is at
  `/Users/sayyid/Documents/memoria-workspace/src-tauri/target/debug/bundle/macos/Memoria.app`. Quit the installed
  Memoria first (two copies would load the models twice), then `open` that path; skip the build below.
- **Build the bundle from this branch** (`call-audio`, not merged). Do not use `pnpm tauri dev` for this test: macOS
  would ask on behalf of the terminal instead of Memoria.

  ```sh
  cd /Users/sayyid/Documents/memoria-wt-call-audio
  pnpm tauri build --debug --bundles app
  ```

  The bundle lands in the Cargo target directory in use, normally `src-tauri/target/debug/bundle/macos/Memoria.app`
  (with `CARGO_TARGET_DIR` set, under that directory instead). Check it:

  ```sh
  app=src-tauri/target/debug/bundle/macos/Memoria.app   # adjust if CARGO_TARGET_DIR was set
  ls $app/Contents/MacOS                               # memoria and memoria-call-audio
  codesign -dv $app/Contents/MacOS/memoria-call-audio 2>&1 | grep -E 'Identifier|Signature'
  plutil -p $app/Contents/Info.plist | grep NSAudioCaptureUsageDescription
  ```

## 1. Permission prompt

1. Open the bundle, start a meeting (any disposable workspace), wait for **Recording**.
2. In the notch, the headset button is **Call audio** (tooltip: "Also record audio playing on this Mac, such as the
   other side of a call"). It is off by default. Turn it on.
3. Expect a macOS prompt that names **Memoria** and asks to record system audio, with the text "Memoria records audio
   playing on this Mac, such as the other side of a call, …". Before answering, open the expanded view (CC): after 3 s
   it says "Call audio is waiting for macOS. …".
4. Choose **Allow**. The line changes to "Recording the microphone and audio playing on this Mac".
5. System Settings › Privacy & Security › Screen & System Audio Recording › **System Audio Recording Only** now lists
   Memoria, switched on.

Note the prompt's exact wording and the app it names.

## 2. A clip with headphones

1. Headphones on. Play a YouTube clip with clear speech in Safari or Chrome. Stay quiet.
2. Expect captions with the clip's words within a few seconds, and the level meter moving with the clip.
3. Speak a sentence yourself: it should be captioned too (microphone and call audio are mixed).
4. End the meeting. In review, the transcript has the clip's words, and the saved recording plays both the clip and
   your voice. The meeting's Source note says "Original recording of the microphone and of audio played on this Mac
   while Call audio was on …".

## 3. A call (optional)

With headphones, join a Teams call (the Teams test call works) or any call. Captions should show both sides; the
saved recording should contain both.

## 4. Switching during the meeting

1. New meeting, Call audio on, clip playing.
2. Turn Call audio off: after a few seconds new words from the clip stop appearing (audio already captured is still
   captioned, and the microphone cannot hear headphones). Turn it on again: they return. No second permission prompt.
3. End: the recording has the clip only for the stretches when Call audio was on.
4. The choice is remembered: the next meeting starts with Call audio in the state you left it.

## 5. Unplugging headphones

1. Meeting running, Call audio on, clip playing in headphones.
2. Unplug (or disconnect Bluetooth). Output moves to the speakers; call audio should continue after a short gap (about
   a second), with no "Call audio stopped" notice. The microphone now hears the speakers too, so the clip is recorded
   twice, slightly apart (expected; Call audio is meant for headphones).
3. Plug back in: call audio continues on the headphones.

## 6. If something goes wrong

- "Call audio stopped: …. Recording continues with the microphone." in the expanded view: note the text. The meeting
  keeps recording; turn the toggle on to retry.
- "Nothing heard from this Mac yet …" after 20 s while a clip plays: the permission is probably off (macOS is reported
  to deliver silence then). Check the System Audio Recording Only list, then turn Call audio off and on.
- Optional: switch Memoria off in that list, start a meeting with Call audio on, and note what happens (a notice, or
  silence with the hint). This path has not been observed yet.

## 7. Afterwards

- After End, and after quitting Memoria during a meeting: `pgrep -fl memoria-call-audio` prints nothing.
- During a meeting, Activity Monitor's % CPU for `memoria-call-audio` (expected to be small).
- Builds are ad-hoc signed: after a rebuild macOS may ask again, and the list may hold an old Memoria entry.

Report: the prompt's wording and named app; whether captions and the recording contained the clip and the call;
any notices; the CPU figure.
