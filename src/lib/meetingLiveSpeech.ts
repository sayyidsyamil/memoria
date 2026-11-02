import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { TranscriptDraft } from '../features/meetings/meetingTypes'
import { withTimeout } from './asyncTimeout'
// Keep the module outside data: URLs, which the production script CSP rejects.
import workletUrl from './meetingPcm.worklet.js?url&no-inline'

export interface CaptionAudioProgress {
  acceptedSamples: number; processedSamples: number; queuedSamples: number
  refusedSamples: number; unacknowledgedSamples: number; sampleRate: number
}
export interface LiveSpeechEvent {
  sessionId: string; stage?: string; speaker?: string; text?: string; transcript?: string
  turns?: TranscriptDraft['segments']; error?: string; done?: boolean; draft?: TranscriptDraft
  audioProgress?: CaptionAudioProgress
  progress?: { phase: string; receivedChunks: number; receivedSamples: number; processedSamples: number }
}
const RATE = 16000
const MAX_QUEUED_SAMPLES = RATE * 30

function blockLevel(samples: Float32Array) {
  let sum = 0
  for (const sample of samples) sum += sample * sample
  return Math.min(1, Math.max(0, (20 * Math.log10(Math.sqrt(sum / (samples.length || 1)) + 1e-6) + 60) / 50))
}

export async function startMeetingLiveSpeech(stream: MediaStream, vaultPath: string, sessionId: string, update: (event: LiveSpeechEvent) => void, signal?: AbortSignal, onLevel?: (level: number) => void) {
  let accepting = true
  let ready = false
  let activated = false
  let closed = false
  let finished = false
  let index = 0
  let failure: Error | null = null
  let queue = Promise.resolve()
  let stopping: Promise<void> | null = null
  let captureFinish: Promise<void> | null = null
  let controls = Promise.resolve()
  let fence: { command: string; resolve: () => void } | null = null
  const progress: CaptionAudioProgress = { acceptedSamples: 0, processedSamples: 0, queuedSamples: 0, refusedSamples: 0, unacknowledgedSamples: 0, sampleRate: RATE }
  const report = () => update({ sessionId, audioProgress: { ...progress } })
  let resolveReady!: () => void
  let rejectReady!: (error: Error) => void
  let resolveFinal!: () => void
  let rejectFinal!: (error: Error) => void
  const readiness = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  const finalization = new Promise<void>((resolve, reject) => { resolveFinal = resolve; rejectFinal = reject })
  void readiness.catch(() => undefined)
  void finalization.catch(() => undefined)
  const abort = () => rejectReady(new Error('Meeting preparation cancelled'))
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const context = new AudioContext({ sampleRate: RATE })
  let unlisten: (() => void) | undefined
  const endWorker = () => invoke<void>('end_live_speech', {
    sessionId, expectedChunks: index, expectedSamples: progress.acceptedSamples,
  })
  try {
    await context.suspend()
    if (context.sampleRate !== RATE) throw new Error('Live captions require a 16 kHz audio context on this device.')
    unlisten = await listen<LiveSpeechEvent>('meeting-live-speech', event => {
      if (event.payload.sessionId !== sessionId) return
      if (event.payload.stage === 'Live captions ready') { ready = true; resolveReady() }
      update(event.payload)
      if (event.payload.error) {
        accepting = false
        failure ??= new Error(event.payload.error)
        rejectReady(failure); rejectFinal(failure); finished = true
      }
      if (event.payload.done) { finished = true; resolveFinal() }
    })
    await invoke('start_live_speech', { vaultPath, sessionId })
    await context.audioWorklet.addModule(workletUrl)
    const source = context.createMediaStreamSource(stream)
    const tap = new AudioWorkletNode(context, 'meeting-pcm')
    const recording = context.createMediaStreamDestination()
    const mute = context.createGain(); mute.gain.value = 0
    source.connect(tap); tap.connect(recording); tap.connect(mute); mute.connect(context.destination)
    function send(samples: Float32Array) {
      if (!accepting || progress.queuedSamples + samples.length > MAX_QUEUED_SAMPLES) {
        progress.refusedSamples += samples.length
        if (accepting) {
          accepting = false
          update({ sessionId, error: 'Transcription is more than 30 seconds behind. New caption audio is refused; accepted audio will drain. Original audio continues to be saved.' })
        }
        report()
        return
      }
      progress.acceptedSamples += samples.length
      progress.queuedSamples += samples.length
      const sequence = index++
      report()
      queue = queue.then(async () => {
        if (failure) { progress.unacknowledgedSamples += samples.length; return }
        const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
        let binary = ''
        for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
        try {
          await invoke<void>('feed_live_speech', { sessionId, index: sequence, data: btoa(binary) })
          progress.processedSamples += samples.length
        } catch (error) {
          failure = error instanceof Error ? error : new Error(String(error))
          accepting = false
          progress.unacknowledgedSamples += samples.length
          update({ sessionId, error: `Live captions stopped: ${failure.message}. Unacknowledged audio is reported; the original recording is preserved.` })
        }
      }).finally(() => { progress.queuedSamples -= samples.length; report() })
    }
    tap.port.onmessage = event => {
      if (event.data?.flushed) {
        if (fence && (!event.data.command || event.data.command === fence.command)) { fence.resolve(); fence = null }
        return
      }
      const samples = event.data
      if (!(samples instanceof Float32Array)) {
        failure = new Error('Invalid PCM worklet message'); accepting = false
        update({ sessionId, error: failure.message })
        return
      }
      if (closed || !ready) return
      onLevel?.(blockLevel(samples))
      send(samples)
    }
    function command(value: string) {
      controls = controls.then(() => withTimeout(new Promise<void>(resolve => {
        fence = { command: value, resolve }; tap.port.postMessage(value)
      }), 5000, 'AudioWorklet did not flush its final PCM. The original recording is preserved; caption tail completion is unverified.'))
      return controls
    }
    await withTimeout(readiness, 60000, 'MOSS preparation timed out. Recording has not started.')
    signal?.removeEventListener('abort', abort)
    if (signal?.aborted) throw new Error('Meeting preparation cancelled')
    function finishCapture() {
      captureFinish ??= activated ? command('stop') : Promise.resolve()
      return captureFinish
    }
    return {
      recordingStream: recording.stream,
      async activate() { await context.resume(); activated = true },
      async pause(value: boolean) { await command(value ? 'pause' : 'resume') },
      finishCapture,
      stop(): Promise<void> {
        if (stopping) return stopping
        stopping = (async () => {
          if (!closed) {
            try { await finishCapture() }
            catch (error) {
              failure = error instanceof Error ? error : new Error(String(error))
              update({ sessionId, error: failure.message })
            }
            accepting = false; closed = true
            source.disconnect(); tap.disconnect(); mute.disconnect()
            recording.disconnect()
            try { await withTimeout(context.close(), 5000, 'Audio context did not close. Keep the original recording for review.') }
            catch (error) { failure = error instanceof Error ? error : new Error(String(error)); update({ sessionId, error: failure.message }) }
          }
          // A native feed already has a bounded acknowledgement timeout. Never
          // cut off accepted frontend audio with a shorter, success-shaped race.
          await queue
          await endWorker()
          if (!finished) await withTimeout(finalization, 60000, 'Transcript finalization timed out. The recording is preserved; recover or refine its saved draft.')
          if (failure) throw failure
        })().finally(() => { unlisten?.() })
        return stopping
      },
      audioProgress: () => ({ ...progress }),
    }
  } catch (error) {
    signal?.removeEventListener('abort', abort)
    accepting = false
    await context.close()
    unlisten?.()
    try { await endWorker() }
    catch (cleanup) { update({ sessionId, error: `Speech cleanup failed: ${String(cleanup)}` }) }
    throw error
  }
}
