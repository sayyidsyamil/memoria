import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
// Small ?url assets are otherwise inlined as data: URLs by Vite. AudioWorklet
// modules are scripts, so the production CSP correctly blocks that form.
import workletUrl from './meetingPcm.worklet.js?url&no-inline'

export interface LiveSpeechEvent { sessionId: string; stage?: string; speaker?: string; text?: string; transcript?: string; turns?: import('../components/MeetingTranscriptReview').TranscriptDraft['segments']; error?: string; done?: boolean; draft?: import('../components/MeetingTranscriptReview').TranscriptDraft }
/** Input level 0–1 for a PCM block: dBFS mapped from -60 dB (silence) to -10 dB (loud). */
function blockLevel(samples: Float32Array) {
  let sum = 0
  for (let index = 0; index < samples.length; index++) sum += samples[index] * samples[index]
  const rms = Math.sqrt(sum / (samples.length || 1))
  return Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-6) + 60) / 50))
}
export async function startMeetingLiveSpeech(stream: MediaStream, vaultPath: string, sessionId: string, update: (event: LiveSpeechEvent) => void, signal?: AbortSignal, onLevel?: (level: number) => void) {
  let stopped = false
  let closing = false
  let ready = false
  const pending: Float32Array[] = []
  let pendingSamples = 0
  let send: ((samples: Float32Array) => void) | null = null
  let paused = false
  let index = 0
  let queue = Promise.resolve()
  let queuedSamples = 0
  let flush: (() => void) | null = null
  let complete: (() => void) | null = null
  let finished = false
  let resolveReady!: () => void
  let rejectReady!: (error: Error) => void
  const readiness = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  // Attach a handler immediately: errors can arrive before addModule finishes.
  void readiness.catch(() => undefined)
  const abort = () => rejectReady(new Error('Meeting preparation cancelled'))
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const readyTimeout = setTimeout(() => rejectReady(new Error('MOSS preparation timed out. Recording has not started.')), 60000)
  const context = new AudioContext({ sampleRate: 16000 })
  await context.suspend()
  if (context.sampleRate !== 16000) { await context.close(); throw new Error('Live captions require a 16 kHz audio context on this device.') }
  const unlisten = await listen<LiveSpeechEvent>('meeting-live-speech', event => {
    if (event.payload.sessionId !== sessionId) return
    if (event.payload.stage === 'Live captions ready') {
      ready = true
      resolveReady()
      if (send) {
        for (const samples of pending) send(samples)
        pending.length = 0; pendingSamples = 0
      }
    }
    update(event.payload)
    if (event.payload.error) rejectReady(new Error(event.payload.error))
    if (event.payload.done || event.payload.error) { finished = true; complete?.() }
  })
  try {
    await invoke('start_live_speech', { vaultPath, sessionId })
    await context.audioWorklet.addModule(workletUrl)
    const source = context.createMediaStreamSource(stream)
    const tap = new AudioWorkletNode(context, 'meeting-pcm')
    const mute = context.createGain(); mute.gain.value = 0
    source.connect(tap); tap.connect(mute); mute.connect(context.destination)
    send = (samples: Float32Array) => {
      if (stopped) return
      queuedSamples += samples.length
      if (queuedSamples > 16000 * 30) {
        stopped = true
        update({ sessionId, error: 'Transcription is more than 30 seconds behind. Original audio continues to be saved.' })
        void invoke('end_live_speech', { sessionId }).catch(() => undefined)
        return
      }
      const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
      const sequence = index++
      queue = queue.then(async () => {
        if (stopped) return
        await invoke<void>('feed_live_speech', { sessionId, index: sequence, data: btoa(binary) })
      }).catch(error => {
        stopped = true; update({ sessionId, error: `Live captions stopped: ${String(error)}. Original audio is still recording.` })
        void invoke('end_live_speech', { sessionId }).catch(() => undefined)
      }).finally(() => { queuedSamples -= samples.length })
    }
    tap.port.onmessage = event => {
      if (event.data.flushed) { flush?.(); return }
      if (stopped || paused) return
      const samples = event.data as Float32Array
      onLevel?.(blockLevel(samples))
      if (!ready) {
        // Preserve up to 30s of startup audio, never silently discard speech.
        pendingSamples += samples.length
        if (pendingSamples > 16000 * 30) {
          stopped = true
          update({ sessionId, error: 'Live model did not become ready within 30 seconds. Original audio is saved for accurate transcription.' })
          void invoke('end_live_speech', { sessionId }).catch(() => undefined)
        } else pending.push(samples.slice())
        return
      }
      send?.(samples)
    }
    await readiness
    clearTimeout(readyTimeout)
    signal?.removeEventListener('abort', abort)
    if (signal?.aborted) throw new Error('Meeting preparation cancelled')
    return {
      async activate() { await context.resume() },
      pause(value: boolean) { paused = value },
      async stop() {
        if (!closing) {
          await Promise.race([new Promise<void>(resolve => { flush = resolve; tap.port.postMessage('flush') }), new Promise<void>(resolve => setTimeout(resolve, 500))])
          closing = true
          source.disconnect(); tap.disconnect(); mute.disconnect()
          await Promise.race([context.close(), new Promise<void>(resolve => setTimeout(resolve, 1500))])
        }
        await Promise.race([queue, new Promise<void>(resolve => setTimeout(resolve, 5000))])
        stopped = true
        await invoke('end_live_speech', { sessionId }).catch(() => undefined)
        if (!finished) await Promise.race([new Promise<void>(resolve => { complete = resolve }), new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Transcript finalization is still running. Retry End to recover the saved draft.')), 60000))])
        unlisten()
        pending.length = 0
      },
    }
  } catch (error) {
    clearTimeout(readyTimeout)
    signal?.removeEventListener('abort', abort)
    await context.close(); unlisten()
    await invoke('end_live_speech', { sessionId }).catch(() => undefined)
    throw error
  }
}
