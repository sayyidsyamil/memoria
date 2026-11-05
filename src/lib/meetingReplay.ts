/** Prerecorded acceptance input. It never requests a microphone or plays to speakers. */
export async function prepareMeetingReplay(file: File, onEnded: () => void) {
  if (!/\.wav$/i.test(file.name) || file.size > 20 * 1024 * 1024) throw new Error('Choose a mono WAV test file smaller than 20 MB.')
  const context = new AudioContext({ sampleRate: 16000 })
  try {
    await context.suspend()
    const audio = await context.decodeAudioData(await file.arrayBuffer())
    if (audio.numberOfChannels !== 1 || !Number.isFinite(audio.duration) || audio.duration <= 0 || audio.duration > 600) {
      throw new Error('Replay requires mono audio between zero and ten minutes long.')
    }
    const source = context.createBufferSource()
    const destination = context.createMediaStreamDestination()
    source.buffer = audio
    source.connect(destination)
    let started = false
    let stopped = false
    let ended = false
    source.onended = () => { if (!stopped) { ended = true; onEnded() } }
    return {
      stream: destination.stream,
      duration: audio.duration,
      ended: () => ended,
      async start() { if (!started) { source.start(); started = true }; await context.resume() },
      async pause(value: boolean) { if (value) await context.suspend(); else await context.resume() },
      async stop() {
        if (stopped) return
        stopped = true; source.onended = null
        if (started && !ended) source.stop()
        source.disconnect(); destination.disconnect()
        destination.stream.getTracks().forEach(track => track.stop())
        await context.close()
      },
    }
  } catch (error) { await context.close(); throw error }
}
