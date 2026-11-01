import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { applySource, type PreparedSource } from '../lib/sourceImport'
import { MeetingTranscriptReview, type TranscriptDraft } from './MeetingTranscriptReview'
import { startMeetingLiveSpeech } from '../lib/meetingLiveSpeech'
import { MeetingHudView, type HudState } from './MeetingHudView'
import { clockText } from '../lib/hud'
import { meetingService } from '../features/meetings/meetingService'
import { checkLiveStatement, type LiveCue } from '../features/temporal/liveAssistanceService'

const METER_BARS = 56

export function MeetingHud() {
  const vaultPath = new URLSearchParams(location.search).get('vault') ?? ''
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const started = useRef(false)
  const ended = useRef(false)
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
  const [liveTurns, setLiveTurns] = useState<TranscriptDraft['segments']>([])
  const layoutQueue = useRef(Promise.resolve())
  const finalDraft = useRef<TranscriptDraft | null>(null)
  // 0 microphone permission, 1 speech model loading, 2 warming, 3 ready — driven by real events.
  const [prep, setPrep] = useState(0)
  const [levels, setLevels] = useState<number[]>(() => Array(METER_BARS).fill(0))
  const [captionError, setCaptionError] = useState('')
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
  const [assistanceEnabled, setAssistanceEnabled] = useState(false)
  const [liveCues, setLiveCues] = useState<LiveCue[]>([])
  const [assistanceNotice, setAssistanceNotice] = useState('')
  const checkedTurns = useRef(new Set<string>())
  const assistanceBusy = useRef(false)
  const assistanceJob = useRef<string | null>(null)
  const assistanceAttempts = useRef(new Map<string, number>())
  const assistanceTurns = useRef(liveTurns)
  useEffect(() => { assistanceTurns.current = liveTurns }, [liveTurns])

  useEffect(() => {
    if (!assistanceEnabled || state !== 'recording') return
    let active = true
    const timer = window.setInterval(() => {
      if (assistanceBusy.current) return
      // The newest turn is provisional; inspect completed earlier turns only.
      const turn = assistanceTurns.current.slice(0, -1).find(item => !checkedTurns.current.has(`${item.start}:${item.text}`))
      if (!turn) return
      const key = `${turn.start}:${turn.text}`
      assistanceAttempts.current.set(key, (assistanceAttempts.current.get(key) ?? 0) + 1)
      assistanceBusy.current = true
      const jobId = crypto.randomUUID()
      assistanceJob.current = jobId
      void checkLiveStatement(vaultPath, turn.text, jobId).then(result => {
        if (!active) return
        checkedTurns.current.add(key)
        if (result.cues?.length) setLiveCues(previous => [...result.cues, ...previous].filter((cue, index, all) => all.findIndex(item => item.factId === cue.factId && item.reason === cue.reason) === index).slice(0, 3))
        setAssistanceNotice(result.warnings?.includes('No approved tracked facts') ? 'No approved tracked facts. Add and approve tracked items before using live checks.' : result.status === 'uncertain' ? 'A statement could not be verified. Inspect the transcript.' : '')
      }).catch(() => {
        if (active) {
          if ((assistanceAttempts.current.get(key) ?? 0) >= 2) checkedTurns.current.add(key)
          setAssistanceNotice('Live evidence checks are unavailable. Recording continues.')
        }
      })
        .finally(() => { assistanceBusy.current = false; if (assistanceJob.current === jobId) assistanceJob.current = null })
    }, 1500)
    return () => {
      active = false; window.clearInterval(timer)
      if (assistanceJob.current) void invoke('cancel_wiki_memory', { jobId: assistanceJob.current }).catch(() => undefined)
    }
  }, [assistanceEnabled, state, vaultPath])

  useEffect(() => {
    const view = transcriptView.current
    if (view && followTranscript.current) view.scrollTop = view.scrollHeight
  }, [caption, captionsOpen])

  useEffect(() => {
    layoutQueue.current = layoutQueue.current.catch(() => undefined).then(() => invoke<void>('layout_meeting_hud', {
      width: review ? 900 : captionsOpen ? 620 : 360,
      height: review ? 740 : captionsOpen ? 540 : error ? 184 : state === 'starting' ? 176 : 68,
      review,
    })).catch(() => undefined)
  }, [error, review, captionsOpen, state])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      try {
        const permission = navigator.mediaDevices.getUserMedia({ audio: true }).then(audio => {
          if (aborted.current) { audio.getTracks().forEach(track => track.stop()); throw new Error('Meeting start cancelled') }
          return audio
        })
        let timeout: ReturnType<typeof setTimeout> | undefined
        const audio = await Promise.race([permission, new Promise<MediaStream>((_, reject) => {
          timeout = setTimeout(() => { aborted.current = true; reject(new Error('Microphone permission is taking too long. Check the macOS permission prompt, then restart the meeting.')) }, 30000)
        })]).finally(() => clearTimeout(timeout))
        stream.current = audio
        setPrep(1)
        const mimeType = ['audio/webm;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type))
        const capture = new MediaRecorder(audio, mimeType ? { mimeType } : undefined)
        recorder.current = capture
        capture.ondataavailable = event => {
          if (!event.data.size) return
          const index = chunks.current.length
          chunks.current.push(event.data)
          diskQueue.current = diskQueue.current.then(async () => {
            const bytes = new Uint8Array(await event.data.arrayBuffer())
            let binary = ''
            for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
            await invoke('save_meeting_chunk', { vaultPath, sessionId: sessionId.current, index, data: btoa(binary) })
          }).catch(error => {
            if (capture.state === 'recording') capture.pause()
            setError(`Audio checkpoint failed: ${String(error)}. End the meeting to save available audio.`); setState('error')
          })
        }
        capture.onerror = () => { setError('Audio capture failed. End the meeting to preserve available audio.'); setState('error') }
        audio.getAudioTracks().forEach(track => { track.onended = () => {
          setError('Microphone disconnected. End the meeting to save the captured audio.'); setState('error')
        } })
        const session = await startMeetingLiveSpeech(audio, vaultPath, sessionId.current, event => {
          if (event.stage?.startsWith('Warming')) setPrep(2)
          if (event.stage === 'Live captions ready') setPrep(3)
          if (event.error) setCaptionError(event.error)
          if (event.text) setCaption(previous => `${previous}${event.text}`)
          if (event.transcript !== undefined) setCaption(event.transcript)
          if (event.turns) setLiveTurns(event.turns)
          if (event.draft) finalDraft.current = event.draft
        }, preparation.current.signal, level => setLevels(previous => [...previous.slice(1), level]))
        live.current = session
        if (aborted.current) { await session.stop(); return }
        capture.start(1000)
        startTime.current = Date.now()
        captureStarted.current = true
        await session.activate()
        await invoke('meeting_capture_ready')
        setState('recording')
      } catch (error) {
        if (recorder.current?.state !== 'inactive') recorder.current?.stop()
        stream.current?.getTracks().forEach(track => track.stop())
        await live.current?.stop().catch(() => undefined)
        if (aborted.current) return
        setError(`Meeting did not start: ${String(error)}`)
        setState('error')
        await invoke('show_meeting_workspace').catch(() => undefined)
      }
    })()
  }, [vaultPath])

  useEffect(() => {
    // Only a real stall is reported: the Microphone step is still pending after a few seconds (usually the macOS permission prompt).
    if (state !== 'starting' || prep > 0) return
    const timer = window.setTimeout(() => setMicSlow(true), 4000)
    return () => window.clearTimeout(timer)
  }, [state, prep])
  useEffect(() => {
    // Recorded time excludes pauses, so it matches the audio file, marked moments and the player.
    const timer = setInterval(() => { if (captureStarted.current) setSeconds(Math.floor(recordedSeconds())) }, 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    markRef.current = markMoment
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
    if (state === 'saving') return
    if (state === 'starting') { aborted.current = true; preparation.current.abort(); stream.current?.getTracks().forEach(track => track.stop()); ended.current = true; await invoke('show_meeting_workspace'); await invoke('finish_meeting_hud'); return }
    setState('saving'); setError('')
    try {
      const capture = recorder.current
      captureStarted.current = false
      setSaveStage('Saving recording')
      if (capture && capture.state !== 'inactive') await new Promise<void>(resolve => { capture.onstop = () => resolve(); capture.stop() })
      setSaveStage('Finishing transcript')
      await live.current?.stop()
      if (!finalDraft.current) finalDraft.current = await invoke<TranscriptDraft | null>('wiki_memory', {
        request: { action: 'meeting_draft', vaultPath, sessionId: sessionId.current },
      }).catch(() => null)
      stream.current?.getTracks().forEach(track => track.stop())
      await diskQueue.current
      setSaveStage('Opening review')
      if (chunks.current.length) {
        const blob = new Blob(chunks.current, { type: capture?.mimeType || 'audio/mp4' })
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const id = sessionId.current
        const title = `Meeting · ${new Date(startTime.current).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
        const hash = await crypto.subtle.digest('SHA-256', bytes)
        const sha256 = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
        savedSource.current ??= { id, title, filename: `meeting-${id}.${blob.type.includes('webm') ? 'webm' : 'm4a'}`, bytes, sha256,
          pages: [`Meeting audio captured over ${Math.floor((Date.now() - startTime.current) / 1000)} seconds, including pauses. Microphone only. Create and review a transcript after the meeting before compiling knowledge.`] }
        const sourcePath = await applySource(savedSource.current, vaultPath)
        await meetingService.save(vaultPath, {
          id, title, status: 'needs-review', audioPath: savedSource.current.originalPath?.slice(vaultPath.replace(/\/$/, '').length + 1),
          sourcePath, created: new Date(startTime.current).toISOString(), draft: finalDraft.current,
          turns: finalDraft.current?.segments ?? [], names: {}, marks,
        })
        await invoke('show_meeting_workspace')
        ended.current = true
        setReview(true)
        return
      } else await invoke('show_meeting_workspace')
      ended.current = true
      await invoke('finish_meeting_hud')
    } catch (error) { setError(`Audio could not be saved: ${String(error)}. Keep this HUD open and retry End.`); setState('error'); await invoke('show_meeting_workspace').catch(() => undefined) }
  }

  function pause() {
    const capture = recorder.current
    if (capture?.state === 'recording') { capture.pause(); pausedAt.current = Date.now(); live.current?.pause(true); setState('paused') }
    else if (capture?.state === 'paused') { capture.resume(); if (pausedAt.current) pausedTotal.current += Date.now() - pausedAt.current; pausedAt.current = null; live.current?.pause(false); setState('recording') }
  }
  if (review && savedSource.current?.originalPath) return <MeetingTranscriptReview vaultPath={vaultPath} sessionId={sessionId.current}
    originalPath={savedSource.current.originalPath} title={savedSource.current.title} created={new Date(startTime.current).toISOString()} liveText={caption} initialDraft={finalDraft.current} initialMarks={marks} onClose={() => invoke('finish_meeting_hud')} />
  return <MeetingHudView state={state} saveStage={saveStage} seconds={seconds} levels={levels} prep={prep} captionsOpen={captionsOpen}
    vaultPath={vaultPath}
    assistanceEnabled={assistanceEnabled} onToggleAssistance={setAssistanceEnabled} liveCues={assistanceEnabled ? liveCues : []} assistanceNotice={assistanceEnabled ? assistanceNotice : ''}
    liveTurns={liveTurns} caption={caption} captionError={captionError} marks={marks} markNotice={markNotice} error={error} micWait={micSlow && state === 'starting' && prep === 0}
    transcriptRef={transcriptView} onTranscriptScroll={event => { const view = event.currentTarget; followTranscript.current = view.scrollHeight - view.scrollTop - view.clientHeight < 40 }}
    onToggleCaptions={setCaptionsOpen} onOpenWorkspace={() => { void invoke('show_meeting_workspace') }} onPause={pause} onEnd={() => { void end() }} onMark={markMoment} />
}
