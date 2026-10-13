import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Channel, invoke } from '@tauri-apps/api/core'
import { ArrowsOutSimple, Microphone, Minus, Pause, Play, Stop, X } from '@phosphor-icons/react'
import { MEMORIA_START_MEETING_EVENT, type StartMeetingEventDetail } from '../utils/memoriaWorkflow'
import { VOICE_CONSENT_QUESTION, shouldAskVoiceConsent, voiceProfileLabels } from '../utils/voiceProfiles'

type TranscribeEvent =
  | { type: 'status'; msg: string }
  | { type: 'ready' }
  | { type: 'level'; rms: number; voiced: boolean }
  | { type: 'partial'; t0: number; t1: number; text: string }
  | { type: 'final'; turns: Turn[]; speakers: SpeakerInfo[]; sessionId: string; duration: number }
  | { type: 'error'; msg: string }

interface Turn {
  t0: number
  t1: number
  speaker: string
  text: string
}

interface SpeakerInfo {
  id: string
  suggested: string | null
}

type Phase = 'idle' | 'starting' | 'recording' | 'paused' | 'finalizing' | 'review'

interface Props {
  onSave: (title: string, markdown: string) => Promise<void> | void
  /** true = opted in, false = declined, null/undefined = never asked (treated as off) */
  rememberVoices?: boolean | null
  onRememberVoicesChange?: (value: boolean) => void
}

const SPEAKER_COLORS = [
  'var(--accent-blue)',
  'var(--accent-green)',
  'var(--accent-purple)',
  'var(--accent-orange)',
  'var(--accent-pink)',
  'var(--accent-teal)',
]

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

export function LiveTranscribePanel({ onSave, rememberVoices, onRememberVoicesChange }: Props) {
  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [partials, setPartials] = useState<{ t0: number; text: string }[]>([])
  const [level, setLevel] = useState(0)
  const [voiced, setVoiced] = useState(false)

  const [turns, setTurns] = useState<Turn[]>([])
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [suggested, setSuggested] = useState<Record<string, string>>({})
  const [sessionId, setSessionId] = useState('')
  const [duration, setDuration] = useState(0)

  const [title, setTitle] = useState('')
  const titleEdited = useRef(false)
  const [elapsed, setElapsed] = useState(0)
  const [saving, setSaving] = useState(false)

  const channelRef = useRef<Channel<TranscribeEvent> | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const autoStartRef = useRef(false)
  const levelPeakRef = useRef(0.02)
  const phaseRef = useRef<Phase>(phase)
  phaseRef.current = phase
  const sessionIdRef = useRef('')
  sessionIdRef.current = sessionId

  useEffect(() => {
    const id = setInterval(() => {
      if (phaseRef.current === 'recording') setElapsed((e) => e + 0.25)
    }, 250)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (phase === 'recording' || phase === 'paused') {
      bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
    }
  }, [partials, phase])

  const close = useCallback(() => {
    if (phaseRef.current === 'recording' || phaseRef.current === 'paused' || phaseRef.current === 'finalizing') return
    const pendingSession = sessionIdRef.current
    if (pendingSession) invoke('discard_voice_session', { sessionId: pendingSession }).catch(() => {})
    setOpen(false)
    setPhase('idle')
    resetState()
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  const speakers = useMemo(() => {
    const seen: string[] = []
    for (const t of turns) if (!seen.includes(t.speaker)) seen.push(t.speaker)
    return seen
  }, [turns])

  const nameOf = useCallback((spk: string) => labels[spk]?.trim() || spk, [labels])
  const colorOf = useCallback(
    (spk: string) => SPEAKER_COLORS[Math.max(0, speakers.indexOf(spk)) % SPEAKER_COLORS.length],
    [speakers],
  )

  const resetState = () => {
    setPartials([]); setTurns([]); setLabels({}); setSuggested({})
    setSessionId(''); setDuration(0); setElapsed(0); setLevel(0)
    levelPeakRef.current = 0.02
    setError(null); setMinimized(false); titleEdited.current = false
    channelRef.current = null
  }

  const start = useCallback(async () => {
    resetState()
    setStatus('starting'); setPhase('starting')
    const channel = new Channel<TranscribeEvent>()
    channelRef.current = channel
    channel.onmessage = (event) => {
      switch (event.type) {
        case 'status': setStatus(event.msg); break
        case 'ready': setElapsed(0); setStatus('recording'); setPhase('recording'); break
        case 'level': {
          const rms = Math.max(0, Number(event.rms) || 0)
          levelPeakRef.current = Math.max(0.015, levelPeakRef.current * 0.96, rms)
          setLevel(Math.min(rms / levelPeakRef.current, 1))
          setVoiced(event.voiced)
          break
        }
        case 'partial': setPartials((prev) => [...prev, { t0: event.t0, text: event.text }]); break
        case 'final': {
          const t = event.turns ?? []
          setTurns(t); setDuration(event.duration ?? 0); setSessionId(event.sessionId ?? '')
          const sug: Record<string, string> = {}
          const lab: Record<string, string> = {}
          for (const sp of event.speakers ?? []) {
            if (sp.suggested) { sug[sp.id] = sp.suggested; lab[sp.id] = sp.suggested }
          }
          setSuggested(sug); setLabels(lab)
          if (!titleEdited.current) setTitle(autoTitle(t))
          setStatus(''); setPhase('review'); setMinimized(false)
          channelRef.current = null
          break
        }
        case 'error': setError(event.msg); setStatus(''); setPhase('idle'); channelRef.current = null; break
      }
    }
    try {
      await invoke('start_live_transcribe', { onEvent: channel })
    } catch (e) {
      setError(String(e)); setStatus(''); setPhase('idle'); channelRef.current = null
    }
  }, [])

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<StartMeetingEventDetail>).detail
      autoStartRef.current = detail?.autoStart === true
      setOpen(true)
      setMinimized(false)
    }
    window.addEventListener(MEMORIA_START_MEETING_EVENT, onOpen)
    return () => window.removeEventListener(MEMORIA_START_MEETING_EVENT, onOpen)
  }, [])

  useEffect(() => {
    if (!open || phase !== 'idle' || !autoStartRef.current) return
    autoStartRef.current = false
    void start()
  }, [open, phase, start])

  const pause = useCallback(async () => {
    setPhase('paused')
    try { await invoke('pause_live_transcribe') } catch (e) { setError(String(e)) }
  }, [])

  const resume = useCallback(async () => {
    setPhase('recording')
    try { await invoke('resume_live_transcribe') } catch (e) { setError(String(e)) }
  }, [])

  const stop = useCallback(async () => {
    setPhase('finalizing'); setMinimized(false); setStatus('transcribing & identifying speakers')
    try { await invoke('stop_live_transcribe') } catch (e) { setError(String(e)); setPhase('idle') }
  }, [])

  const buildMarkdown = useCallback(() => {
    const participants = speakers.map(nameOf)
    const meta = [new Date().toLocaleString()]
    if (duration) meta.push(clock(duration))
    if (participants.length) meta.push(participants.join(', '))
    const header = `> ${meta.join('  ·  ')}`

    let body = ''
    let lastSpeaker = ''
    for (const t of turns) {
      const text = t.text.trim()
      if (!text) continue
      if (t.speaker !== lastSpeaker) {
        body += `\n**${nameOf(t.speaker)}** · ${clock(t.t0)}\n${text}\n`
        lastSpeaker = t.speaker
      } else {
        body += `${text}\n`
      }
    }
    if (!body.trim()) body = '\n_(no speech detected)_\n'

    return [
      `# ${title.trim() || 'Meeting Notes'}`, '', header, '',
      '## Summary', '', '_Add a summary…_', '',
      '## Action items', '', '- [ ] ', '',
      '## Transcript', body,
    ].join('\n')
  }, [title, duration, speakers, turns, nameOf])

  const save = useCallback(async () => {
    setSaving(true)
    try {
      await onSave(title.trim() || 'Meeting Notes', buildMarkdown())
      if (sessionId) {
        // Always sent, even with no names: the backend then deletes the session's embeddings.
        const enrollLabels = voiceProfileLabels(rememberVoices === true, labels, speakers)
        try { await invoke('enroll_voices', { sessionId, labels: enrollLabels }) } catch { /* best effort */ }
      }
      setOpen(false); setPhase('idle'); resetState()
    } finally {
      setSaving(false)
    }
  }, [onSave, title, buildMarkdown, sessionId, speakers, labels, rememberVoices])

  const reassign = (index: number, newSpeaker: string) =>
    setTurns((prev) => prev.map((t, i) => (i === index ? { ...t, speaker: newSpeaker } : t)))
  const editText = (index: number, text: string) =>
    setTurns((prev) => prev.map((t, i) => (i === index ? { ...t, text } : t)))

  // minimized recording chip ------------------------------------------------
  if (open && minimized && (phase === 'recording' || phase === 'paused')) {
    return (
      <div style={chip}>
        <span style={{ ...dot, background: phase === 'paused' ? 'var(--muted-foreground)' : 'var(--accent-red)' }} />
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{clock(elapsed)}</span>
        {phase === 'recording'
          ? <button style={ghost} onClick={pause} title="Pause"><Pause size={14} weight="fill" /></button>
          : <button style={ghost} onClick={resume} title="Resume"><Play size={14} weight="fill" /></button>}
        <button style={ghost} onClick={stop} title="Stop"><Stop size={14} weight="fill" /></button>
        <button style={ghost} onClick={() => setMinimized(false)} title="Expand"><ArrowsOutSimple size={14} /></button>
      </div>
    )
  }

  if (!open || minimized) return null

  const live = phase === 'recording' || phase === 'paused' || phase === 'starting'

  return (
    <div style={backdrop} onMouseDown={close}>
      <div style={card} onMouseDown={(e) => e.stopPropagation()}>
        {/* header */}
        <div style={header}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
            {phase === 'review' ? (
              <input value={title} onChange={(e) => { titleEdited.current = true; setTitle(e.target.value) }} style={titleInput} placeholder="Untitled meeting" />
            ) : (
              <span style={titleText}>Meeting Notes</span>
            )}
            <span style={subtle}>
              {phase === 'recording' ? `Recording · ${clock(elapsed)}`
                : phase === 'paused' ? `Paused · ${clock(elapsed)}`
                : phase === 'finalizing' ? (status || 'Transcribing…')
                : phase === 'review' ? `${speakers.length} speaker${speakers.length === 1 ? '' : 's'} · ${clock(duration)}`
                : phase === 'starting' ? (status || 'Starting…')
                : 'On-device transcription with speaker recognition'}
            </span>
          </div>
          {(phase === 'recording' || phase === 'paused') && (
            <button onClick={() => setMinimized(true)} style={iconBtn(false)} title="Minimize"><Minus size={16} /></button>
          )}
          <button onClick={close} disabled={live || phase === 'finalizing'} style={iconBtn(live || phase === 'finalizing')} title="Close"><X size={16} /></button>
        </div>

        {/* mic meter */}
        {live && (
          <div style={meterWrap}>
            <Microphone size={15} color="var(--muted-foreground)" />
            <div style={meterTrack}>
              <div style={{
                width: `${Math.round((phase === 'paused' ? 0 : level) * 100)}%`,
                height: '100%', borderRadius: 3,
                background: voiced ? 'var(--accent-green)' : 'var(--muted-foreground)',
                transition: 'width 80ms linear',
              }} />
            </div>
          </div>
        )}

        {/* speaker labels (review) */}
        {phase === 'review' && speakers.length > 0 && (
          <div style={labelBar}>
            {speakers.map((spk) => {
              const recognized = suggested[spk] && labels[spk] === suggested[spk]
              return (
                <div key={spk} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ ...dot, background: colorOf(spk) }} />
                  <input value={labels[spk] ?? ''} placeholder={spk} onChange={(e) => setLabels((p) => ({ ...p, [spk]: e.target.value }))} style={labelInput} />
                  {recognized && <span style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>recognized</span>}
                </div>
              )
            })}
          </div>
        )}

        {phase === 'review' && onRememberVoicesChange && shouldAskVoiceConsent({ remember_voices: rememberVoices }, labels, speakers) && (
          <div role="group" aria-label="Voice profiles" style={consentBar}>
            <span>{VOICE_CONSENT_QUESTION} <span style={{ color: 'var(--muted-foreground)' }}>This applies from your next meeting.</span></span>
            <button style={consentButton} onClick={() => onRememberVoicesChange(true)}>Save voice profiles</button>
            <button style={consentButton} onClick={() => onRememberVoicesChange(false)}>No thanks</button>
          </div>
        )}

        {/* body */}
        <div ref={bodyRef} style={body}>
          {error && <div style={{ color: 'var(--accent-red)' }}>{error}</div>}

          {phase === 'idle' && !error && (
            <div style={emptyState}>
              <Microphone size={30} color="var(--muted-foreground)" />
              <div style={{ fontWeight: 500, marginTop: 10 }}>Record a meeting</div>
              <div style={{ color: 'var(--muted-foreground)', maxWidth: 360, marginTop: 4 }}>
                Live transcript as you speak. On stop, speakers are separated — and people
                you’ve named before are recognized by voice.
              </div>
            </div>
          )}

          {live && (partials.length === 0 ? (
            <div style={{ color: 'var(--muted-foreground)', textAlign: 'center', marginTop: 28 }}>
              {phase === 'starting' ? (status.includes('load') ? 'Loading models (first run only)…' : 'Loading…')
                : phase === 'paused' ? 'Paused.' : 'Listening…'}
            </div>
          ) : (
            partials.map((p, i) => (
              <p key={i} style={{ margin: '0 0 9px' }}>
                <span style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>{clock(p.t0)}</span>{' '}{p.text}
              </p>
            ))
          ))}

          {phase === 'finalizing' && (
            <div style={{ color: 'var(--muted-foreground)', textAlign: 'center', marginTop: 28 }}>
              {status || 'Re-transcribing and labelling speakers…'}
            </div>
          )}

          {phase === 'review' && (turns.length === 0 ? (
            <div style={{ color: 'var(--muted-foreground)' }}>No speech detected.</div>
          ) : (
            turns.map((t, i) => {
              const showHeader = i === 0 || turns[i - 1].speaker !== t.speaker
              return (
                <div key={i} style={{ marginBottom: showHeader ? 12 : 3 }}>
                  {showHeader && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                      <span style={{ ...dot, background: colorOf(t.speaker) }} />
                      <select value={t.speaker} onChange={(e) => reassign(i, e.target.value)} style={{ ...speakerSelect, color: colorOf(t.speaker) }} title="Reassign speaker">
                        {speakers.map((s) => <option key={s} value={s}>{nameOf(s)}</option>)}
                      </select>
                      <span style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>{clock(t.t0)}</span>
                    </div>
                  )}
                  <AutoTextarea value={t.text} onChange={(v) => editText(i, v)} />
                </div>
              )
            })
          ))}
        </div>

        {/* footer */}
        <div style={footer}>
          {phase === 'idle' && <button onClick={start} style={primaryBtn}>Start recording</button>}
          {phase === 'starting' && <button disabled style={{ ...primaryBtn, opacity: 0.55 }}>Starting…</button>}
          {phase === 'recording' && (
            <>
              <button onClick={pause} style={textBtn}>Pause</button>
              <button onClick={stop} style={primaryBtn}>Stop &amp; transcribe</button>
            </>
          )}
          {phase === 'paused' && (
            <>
              <button onClick={resume} style={textBtn}>Resume</button>
              <button onClick={stop} style={primaryBtn}>Stop &amp; transcribe</button>
            </>
          )}
          {phase === 'finalizing' && <button disabled style={{ ...primaryBtn, opacity: 0.55 }}>Transcribing…</button>}
          {phase === 'review' && (
            <>
              <button onClick={start} style={textBtn}>Record again</button>
              <button onClick={save} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save note'}</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function autoTitle(turns: Turn[]): string {
  const first = turns.find((t) => t.text.trim())?.text.trim() ?? ''
  if (!first) return `Meeting Notes — ${new Date().toLocaleDateString()}`
  const words = first.split(/\s+/).slice(0, 7).join(' ')
  return words.length < first.length ? `${words}…` : words
}

function AutoTextarea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const fit = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  useEffect(() => { fit(ref.current) }, [value])
  return (
    <textarea ref={ref} value={value} onChange={(e) => { onChange(e.target.value); fit(e.target) }} rows={1} style={turnText} />
  )
}

// ---------------------------------------------------------------- minimal styles
const FLOAT_SHADOW = '0 8px 30px rgba(15,23,42,0.12)'
const chip: React.CSSProperties = {
  position: 'fixed', left: 16, bottom: 44, zIndex: 1500, height: 36, boxSizing: 'border-box',
  display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderRadius: 999,
  border: '1px solid var(--border-subtle, var(--border))', background: 'var(--background)',
  color: 'var(--foreground)', boxShadow: FLOAT_SHADOW, fontSize: 13,
}
const dot: React.CSSProperties = { width: 8, height: 8, borderRadius: '50%', flexShrink: 0, display: 'inline-block' }
const ghost: React.CSSProperties = {
  border: 'none', background: 'transparent', color: 'var(--muted-foreground)',
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', padding: 2,
}
const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.32)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
}
const card: React.CSSProperties = {
  width: 'min(680px, 92vw)', height: 'min(78vh, 720px)', display: 'flex', flexDirection: 'column',
  background: 'var(--background)', color: 'var(--foreground)',
  border: '1px solid var(--border-subtle, var(--border))', borderRadius: 12,
  boxShadow: '0 12px 40px rgba(15,23,42,0.18)', overflow: 'hidden', fontSize: 14,
}
const header: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 8, padding: '18px 22px 14px',
}
const titleText: React.CSSProperties = { fontSize: 15, fontWeight: 600 }
const titleInput: React.CSSProperties = {
  border: 'none', background: 'transparent', color: 'var(--foreground)',
  fontSize: 15, fontWeight: 600, padding: 0, outline: 'none', width: '100%',
}
const subtle: React.CSSProperties = { fontSize: 12, color: 'var(--muted-foreground)' }
const iconBtn = (disabled: boolean): React.CSSProperties => ({
  border: 'none', background: 'transparent', color: 'var(--muted-foreground)',
  cursor: disabled ? 'default' : 'pointer', display: 'inline-flex', opacity: disabled ? 0.3 : 1, padding: 3,
})
const meterWrap: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '4px 22px 14px' }
const meterTrack: React.CSSProperties = { flex: 1, height: 5, borderRadius: 3, background: 'var(--muted, var(--border))', overflow: 'hidden' }
const labelBar: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: 14, padding: '12px 22px',
  borderTop: '1px solid var(--border-subtle, var(--border))',
}
const labelInput: React.CSSProperties = {
  border: 'none', borderBottom: '1px solid var(--border-input, var(--border))',
  borderRadius: 0, background: 'transparent', color: 'var(--foreground)',
  padding: '1px 2px', fontSize: 13, width: 110, outline: 'none',
}
const body: React.CSSProperties = { flex: 1, overflowY: 'auto', padding: '16px 22px' }
const emptyState: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginTop: 44,
}
const speakerSelect: React.CSSProperties = {
  border: 'none', background: 'transparent', fontWeight: 600, fontSize: 13,
  cursor: 'pointer', outline: 'none', padding: 0,
}
const turnText: React.CSSProperties = {
  width: '100%', border: 'none', borderRadius: 4, resize: 'none', background: 'transparent',
  color: 'var(--foreground)', font: 'inherit', lineHeight: 1.6, padding: 0, outline: 'none', overflow: 'hidden',
}
const footer: React.CSSProperties = {
  display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '14px 22px',
  borderTop: '1px solid var(--border-subtle, var(--border))',
}
const primaryBtn: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 7, border: 'none',
  background: 'var(--primary)', color: 'var(--primary-foreground)', cursor: 'pointer', fontSize: 13, fontWeight: 500,
}
const textBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 7, border: 'none', background: 'transparent',
  color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: 13, fontWeight: 500,
}

const consentBar: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 16px',
  borderBottom: '1px solid var(--border)', fontSize: 12.5,
}
const consentButton: React.CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 6, padding: '3px 10px', background: 'var(--background)',
  color: 'var(--foreground)', cursor: 'pointer', fontSize: 12.5,
}
