import { useCallback, useEffect, useRef, useState } from 'react'
import { Channel, invoke } from '@tauri-apps/api/core'
import { File as FileIcon, X } from '@phosphor-icons/react'
import { MEMORIA_IMPORT_SOURCE_EVENT, type ImportSourceEventDetail } from '../utils/memoriaWorkflow'

type ImportEvent =
  | { type: 'status'; msg: string }
  | { type: 'final'; title: string; markdown: string; sourceType: string }
  | { type: 'error'; msg: string }

type Phase = 'idle' | 'importing'

interface Props {
  onSave: (title: string, markdown: string, metadata: { sourceType?: string }) => Promise<void> | void
}

const FILE_EXTENSIONS = [
  'pdf', 'docx', 'pptx', 'xlsx', 'odt', 'rtf',
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp',
  'txt', 'md', 'csv', 'tsv', 'json', 'html', 'htm',
]

export function ImportSourcePanel({ onSave }: Props) {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const close = useCallback(() => {
    if (phase === 'importing') return
    setOpen(false); setUrl(''); setStatus(''); setError(null); setPhase('idle')
  }, [phase])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  useEffect(() => { if (open && phase === 'idle') inputRef.current?.focus() }, [open, phase])

  const runImport = useCallback((source: string) => {
    if (!source.trim()) return
    setError(null); setStatus('starting'); setPhase('importing')
    const channel = new Channel<ImportEvent>()
    channel.onmessage = (ev) => {
      if (ev.type === 'status') setStatus(ev.msg)
      else if (ev.type === 'error') { setError(ev.msg); setStatus(''); setPhase('idle') }
      else if (ev.type === 'final') {
        // fewer steps: save straight to the vault and close
        Promise.resolve(onSave(ev.title || 'Imported source', ev.markdown, { sourceType: ev.sourceType })).then(() => {
          setOpen(false); setUrl(''); setStatus(''); setPhase('idle')
        })
      }
    }
    invoke('import_source', { input: source.trim(), onEvent: channel }).catch((e) => {
      setError(String(e)); setStatus(''); setPhase('idle')
    })
  }, [onSave])

  const chooseFile = useCallback(async () => {
    try {
      const { open: openDialog } = await import('@tauri-apps/plugin-dialog')
      const selected = await openDialog({ multiple: false, filters: [{ name: 'Documents', extensions: FILE_EXTENSIONS }] })
      if (typeof selected === 'string') runImport(selected)
    } catch (e) {
      setError(String(e))
    }
  }, [runImport])

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<ImportSourceEventDetail>).detail
      setOpen(true); setUrl(detail?.input ?? ''); setStatus(''); setError(null); setPhase('idle')

      if (detail?.input) {
        window.setTimeout(() => runImport(detail.input ?? ''), 0)
      } else if (detail?.mode === 'file') {
        window.setTimeout(() => { void chooseFile() }, 0)
      }
    }
    window.addEventListener(MEMORIA_IMPORT_SOURCE_EVENT, onOpen)
    return () => window.removeEventListener(MEMORIA_IMPORT_SOURCE_EVENT, onOpen)
  }, [chooseFile, runImport])

  if (!open) return null

  return (
    <div style={backdrop} onMouseDown={close}>
      <div style={card} onMouseDown={(e) => e.stopPropagation()}>
        <div style={header}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
            <span style={titleText}>Import a source</span>
            <span style={subtle}>
              {phase === 'importing' ? (status || 'Importing…') : 'Web page · YouTube · PDF, Word, slides & more'}
            </span>
          </div>
          <button onClick={close} disabled={phase === 'importing'} style={iconBtn(phase === 'importing')} title="Close"><X size={16} /></button>
        </div>

        <div style={body}>
          {error && <div style={{ color: 'var(--accent-red)', marginBottom: 14 }}>{error}</div>}

          {phase === 'idle' ? (
            <>
              <input
                ref={inputRef}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runImport(url) }}
                placeholder="Paste a web or YouTube link…"
                style={urlInput}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0' }}>
                <div style={hr} /><span style={subtle}>or</span><div style={hr} />
              </div>
              <button onClick={chooseFile} style={fileBtn}>
                <FileIcon size={16} color="var(--muted-foreground)" /> Choose a file
              </button>
            </>
          ) : (
            <div style={{ color: 'var(--muted-foreground)', textAlign: 'center', marginTop: 26 }}>
              {status || 'Working…'}
              {status.includes('models') && <div style={{ fontSize: 12, marginTop: 6 }}>(first run downloads the model once)</div>}
            </div>
          )}
        </div>

        {phase === 'idle' && (
          <div style={footer}>
            <button onClick={() => runImport(url)} disabled={!url.trim()} style={{ ...primaryBtn, opacity: url.trim() ? 1 : 0.5 }}>Import</button>
          </div>
        )}
      </div>
    </div>
  )
}

const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.32)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
}
const card: React.CSSProperties = {
  width: 'min(540px, 92vw)', display: 'flex', flexDirection: 'column',
  background: 'var(--background)', color: 'var(--foreground)',
  border: '1px solid var(--border-subtle, var(--border))', borderRadius: 12,
  boxShadow: '0 12px 40px rgba(15,23,42,0.18)', overflow: 'hidden', fontSize: 14,
}
const header: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '18px 22px 14px' }
const titleText: React.CSSProperties = { fontSize: 15, fontWeight: 600 }
const subtle: React.CSSProperties = { fontSize: 12, color: 'var(--muted-foreground)' }
const iconBtn = (disabled: boolean): React.CSSProperties => ({
  border: 'none', background: 'transparent', color: 'var(--muted-foreground)',
  cursor: disabled ? 'default' : 'pointer', display: 'inline-flex', opacity: disabled ? 0.3 : 1, padding: 3,
})
const body: React.CSSProperties = { padding: '6px 22px 20px', minHeight: 120 }
const urlInput: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', height: 40, padding: '0 12px',
  border: '1px solid var(--border-input, var(--border))', borderRadius: 8,
  background: 'var(--background)', color: 'var(--foreground)', fontSize: 14, outline: 'none',
}
const hr: React.CSSProperties = { flex: 1, height: 1, background: 'var(--border-subtle, var(--border))' }
const fileBtn: React.CSSProperties = {
  width: '100%', height: 42, borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  border: '1px dashed var(--border-default, var(--border))', background: 'transparent', color: 'var(--foreground)',
}
const footer: React.CSSProperties = {
  display: 'flex', justifyContent: 'flex-end', padding: '14px 22px',
  borderTop: '1px solid var(--border-subtle, var(--border))',
}
const primaryBtn: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 7, border: 'none',
  background: 'var(--primary)', color: 'var(--primary-foreground)', cursor: 'pointer', fontSize: 13, fontWeight: 500,
}
