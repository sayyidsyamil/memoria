import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Channel, invoke } from '@tauri-apps/api/core'

type TranscribeEvent =
  | { type: 'status'; msg: string }
  | { type: 'ready' }
  | { type: 'partial'; t0: number; t1: number; text: string }
  | { type: 'final'; markdown: string; turns: Turn[] }
  | { type: 'error'; msg: string }

interface Turn {
  t0: number
  t1: number
  speaker: string
  text: string
}

type Phase = 'idle' | 'starting' | 'recording' | 'finalizing' | 'review'

interface Props {
  onSave: (title: string, markdown: string) => Promise<void> | void
}

const SPEAKER_COLORS = [
  'var(--accent-blue)',
  'var(--accent-green)',
  'var(--accent-purple)',
  'var(--accent-orange)',
  'var(--accent-pink)',
  'var(--accent-teal)',
]

function fmtClock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function LiveTranscribePanel({ onSave }: Props) {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [status, setStatus] = useState('')
  const [partials, setPartials] = useState<{ t0: number; text: string }[]>([])
  const [turns, setTurns] = useState<Turn[]>([])
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [saving, setSaving] = useState(false)

  const channelRef = useRef<Channel<TranscribeEvent> | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const startedAtRef = useRef<number>(0)

  // elapsed timer while recording
  useEffect(() => {
    if (phase !== 'recording') return
    const id = setInterval(() => setElapsed((Date.now() - startedAtRef.current) / 1000), 250)
    return () => clearInterval(id)
  }, [phase])

  // autoscroll live transcript
  useEffect(() => {
    if (phase === 'recording') bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [partials, phase])

  const speakers = useMemo(() => {
    const seen: string[] = []
    for (const t of turns) if (!seen.includes(t.speaker)) seen.push(t.speaker)
    return seen
  }, [turns])

  const nameOf = useCallback(
    (spk: string) => labels[spk]?.trim() || spk,
    [labels],
  )

  const reset = () => {
    setPartials([])
    setTurns([])
    setLabels({})
    setError(null)
    setElapsed(0)
    channelRef.current = null
  }

  const start = useCallback(async () => {
    reset()
    setStatus('starting transcriber')
    setPhase('starting')

    const channel = new Channel<TranscribeEvent>()
    channelRef.current = channel
    channel.onmessage = (event) => {
      switch (event.type) {
        case 'status':
          setStatus(event.msg)
          break
        case 'ready':
          startedAtRef.current = Date.now()
          setElapsed(0)
          setStatus('recording')
          setPhase('recording')
          break
        case 'partial':
          setPartials((prev) => [...prev, { t0: event.t0, text: event.text }])
          break
        case 'final':
          setTurns(event.turns ?? [])
          setTitle(`Meeting Notes — ${new Date().toLocaleString()}`)
          setStatus('')
          setPhase('review')
          channelRef.current = null
          break
        case 'error':
          setError(event.msg)
          setStatus('')
          setPhase('idle')
          channelRef.current = null
          break
      }
    }

    try {
      await invoke('start_live_transcribe', { onEvent: channel })
    } catch (e) {
      setError(String(e))
      setStatus('')
      setPhase('idle')
      channelRef.current = null
    }
  }, [])

  const stop = useCallback(async () => {
    setPhase('finalizing')
    setStatus('transcribing & identifying speakers')
    try {
      await invoke('stop_live_transcribe')
    } catch (e) {
      setError(String(e))
      setPhase('idle')
    }
  }, [])

  const buildMarkdown = useCallback(() => {
    if (turns.length === 0) return '_(no speech detected)_'
    return turns
      .map((t) => `**${nameOf(t.speaker)}** _[${t.t0.toFixed(1)}s]_  ${t.text}`)
      .join('\n\n')
  }, [turns, nameOf])

  const save = useCallback(async () => {
    setSaving(true)
    try {
      await onSave(title.trim() || 'Meeting Notes', buildMarkdown())
      setOpen(false)
      setPhase('idle')
      reset()
    } finally {
      setSaving(false)
    }
  }, [onSave, title, buildMarkdown])

  const close = () => {
    if (phase === 'recording' || phase === 'finalizing') return
    setOpen(false)
    setPhase('idle')
    reset()
  }

  return (
    <>
      <button onClick={() => setOpen(true)} style={triggerStyle}>
        <span style={{ fontSize: 14 }}>🎙</span> Meeting Notes
      </button>

      {open && (
        <div style={backdrop} onMouseDown={close}>
          <div style={card} onMouseDown={(e) => e.stopPropagation()}>
            {/* Header */}
            <div style={header}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                {phase === 'review' ? (
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    style={titleInput}
                    placeholder="Untitled meeting"
                  />
                ) : (
                  <strong style={{ fontSize: 16 }}>Meeting Notes</strong>
                )}
                <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
                  {phase === 'recording'
                    ? `Recording · ${fmtClock(elapsed)}`
                    : phase === 'finalizing'
                      ? 'Transcribing & identifying speakers…'
                      : phase === 'review'
                        ? `${speakers.length} speaker${speakers.length === 1 ? '' : 's'} · ${turns.length} segments`
                        : phase === 'starting'
                          ? status || 'starting…'
                          : 'On-device transcription with speaker diarization'}
                </span>
              </div>
              <button
                onClick={close}
                disabled={phase === 'recording' || phase === 'finalizing'}
                style={closeBtn(phase === 'recording' || phase === 'finalizing')}
                title="Close"
              >
                ✕
              </button>
            </div>

            {/* Speaker label editor (review only) */}
            {phase === 'review' && speakers.length > 0 && (
              <div style={labelBar}>
                <span style={{ fontSize: 11, color: 'var(--muted-foreground)', alignSelf: 'center' }}>
                  Rename speakers:
                </span>
                {speakers.map((spk, i) => (
                  <div key={spk} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ ...dot, background: SPEAKER_COLORS[i % SPEAKER_COLORS.length] }} />
                    <input
                      value={labels[spk] ?? spk}
                      onChange={(e) => setLabels((p) => ({ ...p, [spk]: e.target.value }))}
                      style={labelInput}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Body */}
            <div ref={bodyRef} style={body}>
              {error && <div style={{ color: 'var(--accent-red)' }}>Error: {error}</div>}

              {phase === 'idle' && !error && (
                <div style={emptyState}>
                  <div style={{ fontSize: 40, marginBottom: 8 }}>🎙</div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Record a meeting</div>
                  <div style={{ color: 'var(--muted-foreground)', maxWidth: 360 }}>
                    Live transcript appears as you speak. When you stop, speakers are
                    separated automatically and you can rename them before saving as a note.
                  </div>
                </div>
              )}

              {(phase === 'starting' || phase === 'recording') &&
                (partials.length === 0 ? (
                  <div style={{ color: 'var(--muted-foreground)', textAlign: 'center', marginTop: 24 }}>
                    {phase === 'recording' ? 'Listening… start speaking.' : 'Loading models…'}
                  </div>
                ) : (
                  partials.map((p, i) => (
                    <p key={i} style={{ margin: '0 0 10px' }}>
                      <span style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>
                        [{p.t0.toFixed(1)}s]
                      </span>{' '}
                      {p.text}
                    </p>
                  ))
                ))}

              {phase === 'finalizing' && (
                <div style={{ color: 'var(--muted-foreground)', textAlign: 'center', marginTop: 24 }}>
                  Re-transcribing the full recording and labelling speakers…
                </div>
              )}

              {phase === 'review' &&
                (turns.length === 0 ? (
                  <div style={{ color: 'var(--muted-foreground)' }}>No speech detected.</div>
                ) : (
                  turns.map((t, i) => {
                    const idx = speakers.indexOf(t.speaker)
                    const color = SPEAKER_COLORS[idx % SPEAKER_COLORS.length]
                    return (
                      <div key={i} style={{ marginBottom: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                          <span style={{ color, fontWeight: 600, fontSize: 13 }}>{nameOf(t.speaker)}</span>
                          <span style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>
                            {t.t0.toFixed(1)}s
                          </span>
                        </div>
                        <div style={{ lineHeight: 1.55 }}>{t.text}</div>
                      </div>
                    )
                  })
                ))}
            </div>

            {/* Footer controls */}
            <div style={footer}>
              {phase === 'idle' && (
                <button onClick={start} style={primaryBtn}>Start recording</button>
              )}
              {phase === 'starting' && (
                <button disabled style={{ ...primaryBtn, opacity: 0.6 }}>Starting…</button>
              )}
              {phase === 'recording' && (
                <button onClick={stop} style={{ ...primaryBtn, background: 'var(--accent-red)' }}>
                  ■ Stop &amp; transcribe
                </button>
              )}
              {phase === 'finalizing' && (
                <button disabled style={{ ...primaryBtn, opacity: 0.6 }}>Transcribing…</button>
              )}
              {phase === 'review' && (
                <>
                  <button onClick={start} style={secondaryBtn}>Record again</button>
                  <button onClick={save} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>
                    {saving ? 'Saving…' : 'Save as note'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const triggerStyle: React.CSSProperties = {
  position: 'fixed',
  right: 16,
  bottom: 40,
  zIndex: 900,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-default, var(--border))',
  background: 'var(--card, var(--background))',
  color: 'var(--foreground)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 500,
  boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
}

const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 2000,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
}

const card: React.CSSProperties = {
  width: 'min(760px, 94vw)',
  height: 'min(82vh, 760px)',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--background)',
  color: 'var(--foreground)',
  border: '1px solid var(--border-default, var(--border))',
  borderRadius: 14,
  boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
  overflow: 'hidden',
  fontSize: 14,
}

const header: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  padding: '16px 20px',
  borderBottom: '1px solid var(--border-subtle, var(--border))',
}

const titleInput: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--foreground)',
  fontSize: 16,
  fontWeight: 600,
  padding: 0,
  outline: 'none',
  width: '100%',
}

const closeBtn = (disabled: boolean): React.CSSProperties => ({
  border: 'none',
  background: 'transparent',
  color: 'var(--muted-foreground)',
  cursor: disabled ? 'default' : 'pointer',
  fontSize: 16,
  opacity: disabled ? 0.3 : 1,
  padding: 4,
})

const labelBar: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  padding: '10px 20px',
  borderBottom: '1px solid var(--border-subtle, var(--border))',
  background: 'var(--card, var(--muted))',
}

const dot: React.CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: '50%',
  display: 'inline-block',
}

const labelInput: React.CSSProperties = {
  border: '1px solid var(--border-input, var(--border))',
  borderRadius: 6,
  background: 'var(--background)',
  color: 'var(--foreground)',
  padding: '3px 8px',
  fontSize: 13,
  width: 130,
  outline: 'none',
}

const body: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 20,
}

const emptyState: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  marginTop: 40,
}

const footer: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  justifyContent: 'flex-end',
  padding: '14px 20px',
  borderTop: '1px solid var(--border-subtle, var(--border))',
}

const primaryBtn: React.CSSProperties = {
  padding: '9px 18px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--primary)',
  color: 'var(--primary-foreground)',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 600,
}

const secondaryBtn: React.CSSProperties = {
  padding: '9px 18px',
  borderRadius: 8,
  border: '1px solid var(--border-default, var(--border))',
  background: 'transparent',
  color: 'var(--foreground)',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 500,
}
