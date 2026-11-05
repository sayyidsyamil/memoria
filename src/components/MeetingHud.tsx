import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { applySource, type PreparedSource } from '../lib/sourceImport'
import { MeetingTranscriptReview, type TranscriptDraft } from './MeetingTranscriptReview'
import { startMeetingLiveSpeech, type CaptionAudioProgress } from '../lib/meetingLiveSpeech'
import { prepareMeetingReplay } from '../lib/meetingReplay'
import { withTimeout } from '../lib/asyncTimeout'
import { MeetingHudView, type CueToast, type CueToastHold, type HudState } from './MeetingHudView'
import { clockText } from '../lib/hud'
import { APP_STORAGE_KEYS } from '../constants/appStorage'
import { meetingService } from '../features/meetings/meetingService'
import { recordingService, recordingSource } from '../features/meetings/recordingService'
import type { LiveCue } from '../features/temporal/liveAssistanceService'
import { useMeetingTitles } from '../features/temporal/useMeetingTitles'
import { LiveEvidenceQueue } from '../features/temporal/liveEvidenceQueue'
import { Button } from './ui/button'

const METER_BARS = 56
function captureTitle(startedAt: number, replay: boolean) {
  return `${replay ? 'Audio replay test' : 'Meeting'} · ${new Date(startedAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
}
/** A failure as people read it: the message, without a leading "Error:". */
function errorText(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}
async function persistChunk(vaultPath: string, sessionId: string, index: number, blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  await invoke('save_meeting_chunk', { vaultPath, sessionId, index, data: btoa(binary) })
}

/**
 * A meeting recorder must hear everyone in the room, including a speakerphone or the remote side of a call played by this
 * Mac. Echo cancellation subtracts the Mac's own output and noise suppression can clip quiet speakers, so both are off;
 * automatic gain keeps distant voices audible.
 */
const MEETING_AUDIO: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 }

const NO_CUES: LiveCue[] = []
const CUE_TOAST_MS = 8000
/** What the compact window grows by while a cue toast shows: the toast and its margins in meetingHud.css. */
const CUE_TOAST_HEIGHT = 102
/** The notch: status, timer, captions toggle, a cue badge and four controls (Call audio, workspace, Pause, End). */
const COMPACT_WIDTH = 392

/**
 * A cue that arrives while the window is compact is shown under the notch for eight seconds; the countdown waits while the
 * pointer or keyboard focus is on it. Each cue is announced once, so one first seen expanded, or shown again after the live
 * check was turned off and on, stays quiet.
 */
function useCueToast(cues: LiveCue[], open: boolean) {
  const [toast, setToast] = useState<CueToast | null>(null)
  const [pointer, setPointer] = useState(false)
  const [focus, setFocus] = useState(false)
  const seen = useRef(new Set<string>())
  const countdown = useRef<{ toast: CueToast | null; left: number }>({ toast: null, left: CUE_TOAST_MS })
  const held = pointer || focus
  useEffect(() => {
    const fresh = cues.filter(cue => !seen.current.has(`${cue.factId}:${cue.reason}`))
    fresh.forEach(cue => seen.current.add(`${cue.factId}:${cue.reason}`))
    // Cues come newest first: show the newest, and count the others this toast has stood for.
    if (fresh.length && !open) setToast(previous => ({ cue: fresh[0], more: Math.min(cues.length - 1, (previous ? previous.more + 1 : 0) + fresh.length - 1) }))
  }, [cues, open])
  useEffect(() => {
    if (!toast || held) return
    // A new toast gets the full time; one released from a hold gets what it had left.
    const wait = countdown.current.toast === toast ? countdown.current.left : CUE_TOAST_MS
    const ends = Date.now() + wait
    const timer = window.setTimeout(() => setToast(null), wait)
    return () => { window.clearTimeout(timer); countdown.current = { toast, left: Math.max(0, ends - Date.now()) } }
  }, [toast, held])
  return {
    toast,
    hold: (by: CueToastHold, on: boolean) => (by === 'pointer' ? setPointer : setFocus)(on),
    dismiss: () => { setToast(null); setPointer(false); setFocus(false) },
  }
}

/**
 * What the meeting window says about caption audio: nothing while captions keep up, how far behind they are when
 * they do not, and audio that could not be captioned. The recording itself is never affected.
 */
function captionLag(progress: CaptionAudioProgress | null, stage: string): string {
  if (!progress) return stage
  const seconds = (samples: number) => samples / progress.sampleRate
  const behind = seconds(progress.queuedSamples)
  const lost = seconds(progress.refusedSamples + progress.unacknowledgedSamples)
  return [behind >= 2 ? `Captions ${behind.toFixed(0)} s behind` : '', lost >= .1 ? `${lost.toFixed(1)} s not captioned` : '', stage].filter(Boolean).join(' · ')
}

/**
 * Call audio is off, starting (no frame from the helper yet: macOS holds capture while its permission prompt is open),
 * running (frames arrive, all silent so far) or heard (a frame had sound).
 */
type CallAudioPhase = 'off' | 'starting' | 'running' | 'heard'
const CALL_AUDIO_WAITING_MS = 3000
const CALL_AUDIO_SILENT_MS = 20000
const CALL_AUDIO_STATUS = {
  recording: 'Recording the microphone and audio playing on this Mac',
  waiting: 'Call audio is waiting for macOS. If it asks whether Memoria may record this Mac’s audio, choose Allow.',
  silent: 'Nothing heard from this Mac yet. If a call is playing, allow Memoria in System Settings › Privacy & Security › Screen & System Audio Recording › System Audio Recording Only.',
}

export function MeetingHud() {
  const vaultPath = new URLSearchParams(location.search).get('vault') ?? ''
  const replayMode = new URLSearchParams(location.search).get('replay') === '1'
  const [replayFile, setReplayFile] = useState<File | null>(null)
  const [replayRequested, setReplayRequested] = useState(false)
  const replayInput = useRef<Awaited<ReturnType<typeof prepareMeetingReplay>> | null>(null)
  const pauseRef = useRef<() => Promise<void>>(async () => undefined)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<(Blob | null)[]>([])
  const pendingDisk = useRef(0)
  const started = useRef(false)
  const ended = useRef(false)
  const ending = useRef(false)
  const pauseBusy = useRef(false)
  const savedSource = useRef<PreparedSource | null>(null)
  const sessionId = useRef(crypto.randomUUID())
  const diskQueue = useRef(Promise.resolve())
  const [state, setState] = useState<HudState>('starting')
  const [error, setError] = useState('')
  const [seconds, setSeconds] = useState(0)
  const startTime = useRef(Date.now())
  const [review, setReview] = useState(false)
  const live = useRef<Awaited<ReturnType<typeof startMeetingLiveSpeech>> | null>(null)
  const [caption, setCaption] = useState('')
  // Words still being spoken: shown after the captions, never part of the committed text.
  const [partial, setPartial] = useState('')
  const [liveTurns, setLiveTurns] = useState<TranscriptDraft['segments']>([])
  const layoutQueue = useRef(Promise.resolve())
  const finalDraft = useRef<TranscriptDraft | null>(null)
  // 0 microphone permission, 1 speech model loading, 2 warming, 3 ready — driven by real events.
  const [prep, setPrep] = useState(0)
  const [levels, setLevels] = useState<number[]>(() => Array(METER_BARS).fill(0))
  const [captionError, setCaptionError] = useState('')
  const [audioProgress, setAudioProgress] = useState<CaptionAudioProgress | null>(null)
  const [speechProgress, setSpeechProgress] = useState('')
  const [replayNotice, setReplayNotice] = useState('')
  const [micSlow, setMicSlow] = useState(false)
  const [marks, setMarks] = useState<{ at: number; label: string }[]>([])
  const [markNotice, setMarkNotice] = useState('')
  const pausedTotal = useRef(0)
  const pausedAt = useRef<number | null>(null)
  const markRef = useRef<() => void>(() => undefined)
  const [saveStage, setSaveStage] = useState('Saving recording')
  const [captionsOpen, setCaptionsOpen] = useState(false)
  const aborted = useRef(false)
  const preparation = useRef(new AbortController())
  const captureStarted = useRef(false)
  const transcriptView = useRef<HTMLDivElement | null>(null)
  const followTranscript = useRef(true)
  // On unless the user turned it off: a sentence about no decision costs nothing, and a relevant one under a second.
  const [assistanceEnabled, setAssistanceEnabled] = useState(() => { try { return localStorage.getItem(APP_STORAGE_KEYS.liveCheck) !== 'off' } catch { return true } })
  const toggleAssistance = (on: boolean) => {
    setAssistanceEnabled(on)
    try { localStorage.setItem(APP_STORAGE_KEYS.liveCheck, on ? 'on' : 'off') } catch { /* the choice lasts for this meeting only */ }
  }
  // Off unless the user turned it on: it records other people, and macOS asks for permission the first time.
  const [callAudio, setCallAudio] = useState(() => { try { return localStorage.getItem(APP_STORAGE_KEYS.callAudio) === 'on' } catch { return false } })
  const callAudioWanted = useRef(callAudio)
  const callAudioRecorded = useRef(false)
  const [callAudioPhase, setCallAudioPhase] = useState<CallAudioPhase>('off')
  const [callAudioHint, setCallAudioHint] = useState<'' | 'waiting' | 'silent'>('')
  const [callAudioNotice, setCallAudioNotice] = useState('')
  const toggleCallAudio = (on: boolean) => {
    setCallAudio(on); callAudioWanted.current = on; setCallAudioNotice('')
    try { localStorage.setItem(APP_STORAGE_KEYS.callAudio, on ? 'on' : 'off') } catch { /* the choice lasts for this meeting only */ }
    if (!captureStarted.current || !live.current) return
    setCallAudioPhase(on ? 'starting' : 'off'); setCallAudioHint('')
    void live.current.setCallAudio(on)
  }
  useEffect(() => {
    if (callAudioPhase !== 'starting' && callAudioPhase !== 'running') return
    const waiting = callAudioPhase === 'starting'
    const timer = window.setTimeout(() => setCallAudioHint(waiting ? 'waiting' : 'silent'), waiting ? CALL_AUDIO_WAITING_MS : CALL_AUDIO_SILENT_MS)
    return () => window.clearTimeout(timer)
  }, [callAudioPhase])
  const [liveCues, setLiveCues] = useState<LiveCue[]>([])
  const { titles: cueMeetingTitles } = useMeetingTitles(vaultPath)
  const [assistanceNotice, setAssistanceNotice] = useState('')
  const assistanceTurns = useRef(liveTurns)
  const assistance = useRef<LiveEvidenceQueue | null>(null)
  assistance.current ??= new LiveEvidenceQueue(vaultPath, (cues, notice) => { setLiveCues(cues); setAssistanceNotice(notice) })
  const shownCues = assistanceEnabled ? liveCues : NO_CUES
  const cueToast = useCueToast(shownCues, captionsOpen)
  const cueToastShown = !!cueToast.toast && !captionsOpen && !review
  useEffect(() => { assistanceTurns.current = liveTurns }, [liveTurns])
  useEffect(() => { assistance.current?.setEnabled(assistanceEnabled) }, [assistanceEnabled])
  useEffect(() => {
    if (!assistanceEnabled || state !== 'recording') return
    const timer = window.setInterval(() => { void assistance.current?.inspect(assistanceTurns.current) }, 1500)
    return () => {
      window.clearInterval(timer)
      void assistance.current?.cancel().catch(failure => setAssistanceNotice(`The live check could not be stopped: ${errorText(failure)}`))
    }
  }, [assistanceEnabled, state, vaultPath])
  useEffect(() => () => {
    assistance.current?.setEnabled(false)
    void assistance.current?.cancel().catch(failure => console.error('Live check cancellation failed', failure))
  }, [])

  useEffect(() => {
    const view = transcriptView.current
    if (view && followTranscript.current) view.scrollTop = view.scrollHeight
  }, [caption, liveTurns, partial, captionsOpen])

  useEffect(() => {
    layoutQueue.current = layoutQueue.current.catch(() => undefined).then(() => invoke<void>('layout_meeting_hud', {
      width: review ? 900 : captionsOpen || (replayMode && !replayRequested) ? 620 : COMPACT_WIDTH,
      height: review ? 740 : replayMode && !replayRequested ? 300 : captionsOpen ? 620 : (error ? 184 : state === 'starting' ? 176 : 68) + (cueToastShown ? CUE_TOAST_HEIGHT : 0),
      review,
    })).catch(() => undefined)
  }, [error, review, captionsOpen, state, replayMode, replayRequested, cueToastShown])

  useEffect(() => {
    if (replayMode && (!replayRequested || !replayFile)) return
    if (started.current) return
    started.current = true
    void (async () => {
      // Waiting too long ends preparation like Cancel does, but says why.
      let timedOut = false
      try {
        const permission = (replayMode && replayFile
          ? prepareMeetingReplay(replayFile, () => {
            setReplayNotice('The test audio has ended. End the meeting to review it.')
            void pauseRef.current().catch(failure => { setError(errorText(failure)); setState('error') })
          }).then(input => { replayInput.current = input; return input.stream })
          : navigator.mediaDevices.getUserMedia({ audio: MEETING_AUDIO })).then(audio => {
          if (aborted.current) { audio.getTracks().forEach(track => track.stop()); throw new Error('Meeting start cancelled') }
          return audio
        })
        let timeout: ReturnType<typeof setTimeout> | undefined
        const audio = await Promise.race([permission, new Promise<MediaStream>((_, reject) => {
          timeout = setTimeout(() => { aborted.current = true; timedOut = true; reject(new Error(replayMode ? 'The test audio took too long to load.' : 'Microphone access is taking too long. Check for the macOS permission prompt, then start the meeting again.')) }, 30000)
        })]).finally(() => clearTimeout(timeout))
        stream.current = audio
        setPrep(1)
        const session = await startMeetingLiveSpeech(audio, vaultPath, sessionId.current, event => {
          if (event.stage?.startsWith('Warming')) setPrep(2)
          if (event.stage === 'Live captions ready') setPrep(3)
          if (event.error) setCaptionError(event.error)
          if (event.text) setCaption(previous => `${previous}${event.text}`)
          if (event.transcript !== undefined) setCaption(event.transcript)
          if (event.turns) setLiveTurns(event.turns)
          // An event without `partial` leaves the words being spoken as they are; an empty one clears them.
          if (typeof event.partial === 'string') setPartial(event.partial)
          if (event.draft) finalDraft.current = event.draft
          if (event.audioProgress) setAudioProgress(event.audioProgress)
          if (event.progress) setSpeechProgress(event.progress.phase === 'finalizing' ? 'Finishing captions' : '')
          if (event.callAudioStarted) { setCallAudioPhase(phase => phase === 'starting' ? 'running' : phase); setCallAudioHint('') }
          if (event.callAudioHeard) { setCallAudioPhase('heard'); setCallAudioHint(''); callAudioRecorded.current = true }
          if (event.callAudioError) {
            setCallAudio(false); callAudioWanted.current = false
            setCallAudioPhase('off'); setCallAudioHint(''); setCallAudioNotice(event.callAudioError)
          }
        }, preparation.current.signal, level => setLevels(previous => [...previous.slice(1), level]))
        live.current = session
        if (aborted.current) { await session.stop(); return }
        const mimeType = ['audio/webm;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type))
        const capture = new MediaRecorder(session.recordingStream, mimeType ? { mimeType } : undefined)
        recorder.current = capture
        capture.ondataavailable = event => {
          if (!event.data.size) return
          const index = chunks.current.length
          chunks.current.push(event.data); pendingDisk.current++
          diskQueue.current = diskQueue.current.then(async () => { await persistChunk(vaultPath, sessionId.current, index, event.data); chunks.current[index] = null }).catch(failure => {
            if (capture.state === 'recording') {
              capture.pause(); pausedAt.current ??= Date.now()
              void session.pause(true).catch(error => setCaptionError(errorText(error)))
            }
            setError(`Audio could not be saved: ${errorText(failure)}. Recording is paused; End saves what was recorded.`); setState('error')
          }).finally(() => { pendingDisk.current-- })
          if (pendingDisk.current > 30 && capture.state === 'recording') {
            capture.pause(); pausedAt.current ??= Date.now()
            void session.pause(true).catch(failure => setCaptionError(errorText(failure)))
            setError('Saving audio fell 30 seconds behind, so recording is paused. End the meeting to save what was recorded.'); setState('error')
          }
        }
        capture.onerror = () => {
          void session.pause(true).catch(failure => setCaptionError(errorText(failure)))
          setError('Recording stopped unexpectedly. End the meeting to save what was recorded.'); setState('error')
        }
        audio.getAudioTracks().forEach(track => { track.onended = () => {
          if (!captureStarted.current || ending.current) return
          void session.pause(true).catch(failure => setCaptionError(errorText(failure)))
          setError('The audio input was disconnected. End the meeting to save what was recorded.'); setState('error')
        } })
        startTime.current = Date.now()
        await recordingService.begin(vaultPath, sessionId.current, {
          title: captureTitle(startTime.current, replayMode), created: new Date(startTime.current).toISOString(), mimeType: capture.mimeType, sourceKind: replayMode ? 'replay' : 'microphone',
        })
        capture.start(1000)
        captureStarted.current = true
        await session.activate()
        // The remembered choice applies once recording runs; a prerecorded test never records this Mac's audio.
        if (!replayMode && callAudioWanted.current) { setCallAudioPhase('starting'); void session.setCallAudio(true) }
        await replayInput.current?.start()
        await invoke('meeting_capture_ready')
        setState('recording')
      } catch (error) {
        if (recorder.current?.state !== 'inactive') recorder.current?.stop()
        stream.current?.getTracks().forEach(track => track.stop())
        await replayInput.current?.stop()
        try { await live.current?.stop() }
        catch (failure) { setCaptionError(`Live captions did not stop cleanly: ${errorText(failure)}`) }
        if (aborted.current && !timedOut) return
        setError(`Meeting did not start: ${errorText(error)}`)
        setState('error')
        await invoke('show_meeting_workspace').catch(() => undefined)
      }
    })()
  }, [vaultPath, replayMode, replayFile, replayRequested])

  useEffect(() => {
    // Only a real stall is reported: the Microphone step is still pending after a few seconds (usually the macOS permission prompt).
    if (state !== 'starting' || prep > 0 || replayMode) return
    const timer = window.setTimeout(() => setMicSlow(true), 4000)
    return () => window.clearTimeout(timer)
  }, [state, prep, replayMode])
  useEffect(() => {
    // Recorded time excludes pauses, so it matches the audio file, marked moments and the player.
    const timer = setInterval(() => { if (captureStarted.current) setSeconds(Math.floor(recordedSeconds())) }, 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    markRef.current = markMoment
    pauseRef.current = pause
  })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key.toLowerCase() === 'm' && !event.metaKey && !event.ctrlKey && !event.altKey && !target?.closest?.('input, textarea, select')) markRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const promise = getCurrentWindow().onCloseRequested(event => {
      if (!ended.current) { event.preventDefault(); setError('Use End to stop recording and save the audio.') }
    })
    return () => { void promise.then(unlisten => unlisten()) }
  }, [])

  function recordedSeconds() {
    const now = Date.now()
    return Math.max(0, (now - startTime.current - pausedTotal.current - (pausedAt.current ? now - pausedAt.current : 0)) / 1000)
  }
  function markMoment() {
    if (!captureStarted.current || (state !== 'recording' && state !== 'paused')) return
    const at = Math.round(recordedSeconds() * 10) / 10
    setMarks(previous => [...previous, { at, label: '' }])
    setMarkNotice(`Marked ${clockText(Math.floor(at))}`)
    window.setTimeout(() => setMarkNotice(''), 2500)
  }

  async function end() {
    if (ending.current) return
    if (state === 'starting') { aborted.current = true; preparation.current.abort(); stream.current?.getTracks().forEach(track => track.stop()); ended.current = true; await invoke('show_meeting_workspace'); await invoke('finish_meeting_hud'); return }
    ending.current = true
    setState('saving'); setError('')
    try {
      const capture = recorder.current
      captureStarted.current = false
      setSaveStage('Saving recording')
      const warnings: string[] = []
      try { await live.current?.finishCapture() }
      catch (failure) { warnings.push(`Live captions did not finish: ${errorText(failure)}`); setCaptionError(warnings[warnings.length - 1]) }
      if (capture && capture.state !== 'inactive') await withTimeout(new Promise<void>(resolve => { capture.onstop = () => resolve(); capture.stop() }), 10000, 'The recorder did not stop.')
      await replayInput.current?.stop()
      stream.current?.getAudioTracks().forEach(track => { track.onended = null })
      stream.current?.getTracks().forEach(track => track.stop())
      await diskQueue.current
      for (let index = 0; index < chunks.current.length; index++) {
        const blob = chunks.current[index]
        if (blob) { await persistChunk(vaultPath, sessionId.current, index, blob); chunks.current[index] = null }
      }
      if (chunks.current.length) {
        const id = sessionId.current
        const recording = await recordingService.finalize(vaultPath, id, chunks.current.length)
        savedSource.current ??= recordingSource(recording, callAudioRecorded.current)
        const sourcePath = await applySource(savedSource.current, vaultPath)
        await meetingService.save(vaultPath, {
          id, title: savedSource.current.title, status: 'needs-review', audioPath: recording.originalPath.slice(vaultPath.replace(/\/$/, '').length + 1),
          sourcePath, created: recording.metadata.created, marks,
        })
        setSaveStage('Finishing transcript')
        try { await live.current?.stop() }
        catch (failure) { warnings.push(`The live transcript did not finish: ${errorText(failure)}`); setCaptionError(warnings[warnings.length - 1]) }
        if (!finalDraft.current) {
          try { finalDraft.current = await invoke<TranscriptDraft | null>('wiki_memory', { request: { action: 'meeting_draft', vaultPath, sessionId: id } }) }
          catch (failure) { warnings.push(`The live transcript could not be read: ${errorText(failure)}`); setCaptionError(warnings[warnings.length - 1]) }
        }
        if (finalDraft.current) {
          // Audio the captions missed is shown in review from these counts.
          const progress = live.current?.audioProgress()
          finalDraft.current = { ...finalDraft.current, captionAudio: progress, warnings: [...finalDraft.current.warnings, ...warnings, ...recording.warnings] }
          if (assistanceEnabled) {
            setSaveStage('Checking against decisions')
            try { finalDraft.current.liveChecks = await assistance.current?.finish(finalDraft.current.segments) }
            catch (failure) {
              finalDraft.current.liveChecks = { checkedTurns: 0, uncheckedTurns: finalDraft.current.segments.length, warnings: [`The last statements were not checked: ${errorText(failure)}`] }
            }
            finalDraft.current.warnings.push(...(finalDraft.current.liveChecks?.warnings ?? []))
          }
        }
        await meetingService.save(vaultPath, { id, status: 'needs-review', draft: finalDraft.current, turns: finalDraft.current?.segments ?? [] })
        await recordingService.complete(vaultPath, id, sourcePath)
        setSaveStage('Opening review')
        await invoke('show_meeting_workspace')
        ended.current = true
        setReview(true)
        return
      } else {
        try { await live.current?.stop() }
        catch (failure) { setCaptionError(errorText(failure)) }
        await invoke('show_meeting_workspace')
      }
      ended.current = true
      await invoke('finish_meeting_hud')
    } catch (error) { setError(`Audio could not be saved: ${errorText(error)}. What was recorded is kept. Keep this window open and press End again.`); setState('error'); await invoke('show_meeting_workspace').catch(() => undefined) }
    finally { ending.current = false }
  }

  async function pause() {
    if (ending.current || pauseBusy.current) return
    pauseBusy.current = true
    const capture = recorder.current
    try {
      if (capture?.state === 'recording') {
        await live.current?.pause(true)
        capture.pause(); pausedAt.current = Date.now()
        await replayInput.current?.pause(true); setState('paused')
        setPartial('')  // nobody is speaking into a paused meeting
      } else if (capture?.state === 'paused' && !replayInput.current?.ended()) {
        capture.resume()
        if (pausedAt.current) pausedTotal.current += Date.now() - pausedAt.current
        pausedAt.current = null
        await live.current?.pause(false); await replayInput.current?.pause(false); setState('recording')
      }
    } catch (failure) { setError(`Could not pause or resume: ${errorText(failure)}. End the meeting to save the recording.`); setState('error') }
    finally { pauseBusy.current = false }
  }
  if (replayMode && !replayRequested) return <main className="meeting-hud"><section className="meeting-hud-replay">
    <h1>Replay a recording</h1>
    <p>Runs a mono WAV file of up to ten minutes through recording and live captions, as in a meeting. Use public or fictional audio; the microphone stays off and nothing is played aloud.</p>
    <label>WAV file<input aria-label="WAV file to replay" type="file" accept=".wav,audio/wav" onChange={event => setReplayFile(event.target.files?.[0] ?? null)} /></label>
    {error && <p role="alert">{error}</p>}
    <div><Button disabled={!replayFile} onClick={() => { setReplayRequested(true) }}>Start replay</Button><Button variant="ghost" onClick={() => { void end() }}>Cancel replay</Button></div>
  </section></main>
  if (review && savedSource.current?.originalPath) return <MeetingTranscriptReview vaultPath={vaultPath} sessionId={sessionId.current}
    originalPath={savedSource.current.originalPath} title={savedSource.current.title} created={new Date(startTime.current).toISOString()} liveText={caption} initialDraft={finalDraft.current} initialMarks={marks} onClose={() => invoke('finish_meeting_hud')} />
  const callAudioStatus = state !== 'recording' ? '' : callAudioHint ? CALL_AUDIO_STATUS[callAudioHint] : callAudioPhase === 'running' || callAudioPhase === 'heard' ? CALL_AUDIO_STATUS.recording : ''
  return <MeetingHudView state={state} saveStage={saveStage} seconds={seconds} levels={levels} prep={prep} captionsOpen={captionsOpen}
    vaultPath={vaultPath}
    sourceKind={replayMode ? 'replay' : 'microphone'} replayNotice={replayNotice}
    callAudio={callAudio} onToggleCallAudio={replayMode ? undefined : toggleCallAudio} callAudioStatus={callAudioStatus} callAudioNotice={callAudioNotice}
    progressText={captionLag(audioProgress, speechProgress)}
    assistanceEnabled={assistanceEnabled} onToggleAssistance={toggleAssistance} liveCues={shownCues} assistanceNotice={assistanceEnabled ? assistanceNotice : ''} cueMeetingTitles={cueMeetingTitles}
    cueToast={cueToast.toast} onHoldCueToast={cueToast.hold} onDismissCueToast={cueToast.dismiss}
    liveTurns={liveTurns} partial={partial} caption={caption} captionError={captionError} marks={marks} markNotice={markNotice} error={error} micWait={micSlow && state === 'starting' && prep === 0}
    transcriptRef={transcriptView} onTranscriptScroll={event => { const view = event.currentTarget; followTranscript.current = view.scrollHeight - view.scrollTop - view.clientHeight < 40 }}
    onToggleCaptions={open => { setCaptionsOpen(open); if (open) cueToast.dismiss() }} onOpenWorkspace={() => { void invoke('show_meeting_workspace') }} onPause={() => { void pause() }} onEnd={() => { void end() }} onMark={markMoment} />
}
