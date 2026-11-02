import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '../../components/ui/button'
import { applySource } from '../../lib/sourceImport'
import { whenLabel } from '../../lib/format'
import { meetingService, MeetingServiceError } from './meetingService'
import { recordingService, recordingSource, type RecordingList } from './recordingService'
import type { MeetingRecord, TranscriptDraft } from './meetingTypes'

export function RecordingRecovery({ vaultPath, active, onRecovered }: { vaultPath: string; active: boolean; onRecovered: (record: MeetingRecord) => void }) {
  const [list, setList] = useState<RecordingList | null>(null)
  const [error, setError] = useState('')
  const [recovering, setRecovering] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!active) return
    let current = true
    void recordingService.list(vaultPath).then(result => { if (current) { setList(result); setError('') } })
      .catch(failure => { if (current) setError(`Recording recovery could not be loaded: ${String(failure)}`) })
    return () => { current = false }
  }, [active, vaultPath, version])

  async function recover(sessionId: string) {
    if (recovering) return
    setRecovering(sessionId); setError('')
    try {
      const original = await recordingService.finalize(vaultPath, sessionId)
      let existing: MeetingRecord | null = null
      try { existing = await meetingService.get(vaultPath, sessionId) }
      catch (failure) { if (!(failure instanceof MeetingServiceError) || failure.code !== 'MEETING_NOT_FOUND') throw failure }
      const sourcePath = existing?.sourcePath ?? await applySource(recordingSource(original), vaultPath)
      let record = existing
      if (!existing?.transcriptPath) {
        const draft = existing?.draft ?? await invoke<TranscriptDraft | null>('wiki_memory', { request: { action: 'meeting_draft', vaultPath, sessionId } })
        const warnings = [...original.warnings, 'Interrupted recording: the last uncheckpointed audio and media-container tail may be missing. Listen before relying on this evidence.']
        const reviewedDraft = draft ? { ...draft, warnings: [...draft.warnings, ...warnings] } : null
        record = await meetingService.save(vaultPath, {
          id: sessionId, title: existing?.title ?? original.metadata.title, status: 'needs-review',
          created: existing?.created ?? original.metadata.created,
          audioPath: existing?.audioPath ?? original.originalPath.slice(vaultPath.replace(/\/$/, '').length + 1), sourcePath,
          draft: reviewedDraft, turns: existing?.turns ?? reviewedDraft?.segments ?? [],
        })
      }
      await recordingService.complete(vaultPath, sessionId, sourcePath)
      if (!record) throw new Error('Recovered meeting publication could not be confirmed.')
      setList(previous => previous ? { ...previous, recordings: previous.recordings.filter(item => item.sessionId !== sessionId) } : previous)
      onRecovered(record)
    } catch (failure) { setError(`Recording recovery failed: ${String(failure)}. Original fragments are retained; retry without deleting them.`) }
    finally { setRecovering(null) }
  }
  if (!active || (!error && !list?.recordings.length && !list?.activeRecording)) return null
  return <section className="hub-page" aria-label="Interrupted recordings">
    <h2>Interrupted recordings</h2>
    {error && <p role="alert" className="hub-error">{error}</p>}
    {list?.activeRecording && <p className="hub-muted">End or close the current meeting HUD before recovering another recording.</p>}
    {!!list?.recordings.length && <p className="hub-muted">Recover checkpointed audio into review. The final uncheckpointed passage or container tail may be missing. Nothing is deleted or approved.</p>}
    {list?.recordings.map(item => <article key={item.sessionId} className="hub-meeting">
      <div className="hub-meeting-main"><h3>{item.metadata.title}</h3><p className="hub-meta">{whenLabel(item.metadata.created)} · {item.chunkCount} checkpoints · {(item.byteLength / 1024).toFixed(1)} KiB</p>
        {item.warnings.map(warning => <p key={warning} className="hub-muted">{warning}</p>)}</div>
      <Button disabled={!!recovering} onClick={() => { void recover(item.sessionId) }}>{recovering === item.sessionId ? 'Recovering…' : 'Recover recording'}</Button>
    </article>)}
    {error && <Button variant="outline" disabled={!!recovering} onClick={() => setVersion(value => value + 1)}>Retry recovery list</Button>}
  </section>
}
