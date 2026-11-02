import { useEffect, useRef, useState } from 'react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { applySource, prepareSource } from '../lib/sourceImport'
import { readImportQueue, writeImportQueue, type ImportItem } from '../lib/sourceImportQueue'
import { openNoteInNewWindow } from '../utils/openNoteWindow'
import { MemoryReview } from './MemoryReview'
import { FileText, UploadSimple, CheckCircle, DownloadSimple } from '@phosphor-icons/react'
import './sourceIntake.css'

export function SourceIntake({ vaultPath }: { vaultPath: string }) {
  const input = useRef<HTMLInputElement>(null)
  const queue = useRef<ImportItem[]>([])
  const writes = useRef(Promise.resolve())
  const applying = useRef(new Set<string>())
  const [items, setItems] = useState<ImportItem[]>([])
  const [ready, setReady] = useState(false)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [review, setReview] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const [knowledgeSource, setKnowledgeSource] = useState<string | null>(null)
  const item = items.find(candidate => candidate.id === review)

  function persist(next: ImportItem[]): Promise<void> {
    queue.current = next
    setItems(next)
    const operation = writes.current.catch(() => undefined).then(() => writeImportQueue(vaultPath, next))
    writes.current = operation
    void operation.then(() => setStorageError(null), () => setStorageError('Could not save the import queue. Keep this window open and retry.'))
    return operation
  }
  function patch(id: string, value: Partial<ImportItem>) {
    return persist(queue.current.map(candidate => candidate.id === id ? { ...candidate, ...value } : candidate))
  }

  async function extract(item: ImportItem) {
    try {
      if (!item.file) throw new Error('Choose this file again to resume extraction.')
      const source = await prepareSource(item.file)
      await patch(item.id, { source, file: undefined, state: 'review', error: undefined })
      setReview(current => current ?? item.id)
    } catch (error) {
      await patch(item.id, { state: 'error', error: String(error instanceof Error ? error.message : error) }).catch(() => undefined)
    }
  }

  useEffect(() => {
    let active = true
    void readImportQueue(vaultPath).then(stored => {
      if (!active) return
      const restored = stored.map(candidate => candidate.state === 'saving'
        ? { ...candidate, state: 'review' as const, error: 'Import was interrupted. Apply again to finish.' } : candidate)
      queue.current = restored
      setItems(restored)
      setReady(true)
      for (const candidate of restored) if (candidate.state === 'processing') void extract(candidate)
    }).catch(() => {
      if (active) setStorageError('Could not read saved imports. Reopen the app to retry; saved imports have not been replaced.')
    })
    return () => { active = false }
    // The parent keys this component by vaultPath; loading must run once per workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath])

  async function addFiles(files: File[]) {
    if (!ready) return
    for (const file of files) {
      const candidate: ImportItem = { id: crypto.randomUUID(), name: file.name, state: 'processing', file }
      try { await persist([...queue.current, candidate]) } catch { return }
      await extract(candidate)
    }
  }

  async function apply(candidate: ImportItem, build = false) {
    if (!candidate.source || candidate.state !== 'review' || applying.current.has(candidate.id)) return
    applying.current.add(candidate.id)
    try {
      await patch(candidate.id, { state: 'saving', error: undefined })
      const sourcePath = await applySource(candidate.source, vaultPath, () => patch(candidate.id, { source: candidate.source }))
      await patch(candidate.id, { state: 'saved', sourcePath, source: undefined, file: undefined })
      setReview(null)
      setShowCompleted(true)
      if (build) { setOpen(false); setKnowledgeSource(sourcePath) }
      else {
        const next = queue.current.find(item => item.id !== candidate.id && item.state === 'review')
        if (next) setReview(next.id)
        setOpen(true)
      }
    } catch (error) {
      await patch(candidate.id, { state: 'review', error: String(error) }).catch(() => undefined)
    } finally { applying.current.delete(candidate.id) }
  }

  async function retry(candidate: ImportItem) {
    if (!candidate.file || candidate.state !== 'error') return
    await patch(candidate.id, { state: 'processing', error: undefined })
    await extract(candidate)
  }

  async function openSource(candidate: ImportItem) {
    if (!candidate.sourcePath) return
    try {
      await openNoteInNewWindow(`${vaultPath}/${candidate.sourcePath}`, vaultPath, candidate.name)
      setOpen(false)
    } catch (error) { await patch(candidate.id, { error: `Could not open source: ${String(error)}` }) }
  }

  const pending = items.filter(candidate => candidate.state === 'review').length
  const completed = items.filter(candidate => candidate.state === 'saved' || candidate.state === 'rejected')
  const visible = items.filter(candidate => showCompleted || (candidate.state !== 'saved' && candidate.state !== 'rejected'))
  return <>
    <Button className="workspace-row" variant="ghost" onClick={() => {
      const next = items.find(candidate => candidate.state === 'review')
      setOpen(true)
      if (next) setReview(next.id)
      else if (ready) input.current?.click()
    }} aria-label="Import files">
      <DownloadSimple size={16} /><span>Import files{pending ? ` (${pending} to review)` : ''}</span>
    </Button>
    {knowledgeSource && <MemoryReview key={knowledgeSource} vaultPath={vaultPath} sourcePath={knowledgeSource} autoOpen hideTrigger />}
    <input aria-label="Choose source files" ref={input} type="file" accept=".pdf,.txt,.md,.vtt,.srt" multiple hidden onChange={event => {
      void addFiles(Array.from(event.target.files ?? [])); event.target.value = ''
    }} />
    <Dialog open={open && !item} onOpenChange={setOpen}>
      <DialogContent className="source-intake-dialog">
        <DialogHeader className="source-intake-header"><DialogTitle>Import files</DialogTitle>
          <DialogDescription>Choose documents. Check the text. Add them to your knowledge.</DialogDescription>
        </DialogHeader>
        {storageError && <p role="alert" className="text-sm text-destructive">{storageError}</p>}
        <div className="source-intake-drop"
          data-dragging={dragging}
          onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true) } }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => { event.preventDefault(); setDragging(false); void addFiles(Array.from(event.dataTransfer.files)) }}>
          <UploadSimple size={22} className="text-muted-foreground" />
          <div><p className="source-intake-drop-title">Drop documents here</p><p className="source-intake-format">PDF, TXT, Markdown, VTT or SRT · up to 20 MB each</p></div>
          <Button variant="outline" disabled={!ready} onClick={() => input.current?.click()}>Choose files</Button>
        </div>
        {(visible.length > 0 || completed.length > 0) && <div className="source-intake-list-header"><span>{showCompleted ? 'All imports' : 'Pending files'} <span className="text-muted-foreground">{visible.length}</span></span>{completed.length > 0 && <button onClick={() => setShowCompleted(value => !value)}>{showCompleted ? 'Hide completed' : `Show completed (${completed.length})`}</button>}</div>}
        <ul className="source-intake-list" aria-label="Import queue" aria-live="polite">
          {visible.map(candidate => <li className="source-intake-file" key={candidate.id}>
            <div className="source-intake-file-top">
              {candidate.state === 'saved' ? <CheckCircle size={18} className="text-muted-foreground" /> : <FileText size={18} className="text-muted-foreground" />}
              <div className="source-intake-file-info"><span className="source-intake-filename" title={candidate.name}>{candidate.name}</span><span className="source-intake-file-status">{{ processing: 'Extracting text…', saving: 'Importing…', error: 'Needs attention', rejected: 'Not imported', review: 'Ready to review', saved: 'Imported' }[candidate.state]}</span></div>
              {candidate.state === 'error' && candidate.file ? <Button size="sm" variant="outline" onClick={() => { void retry(candidate).catch(() => undefined) }}>Retry</Button>
                : candidate.state === 'review' ? <Button size="sm" variant="outline" onClick={() => setReview(candidate.id)}>Review</Button>
                : candidate.state === 'saved' ? <Button size="sm" variant="ghost" onClick={() => { void openSource(candidate) }}>Open source</Button> : null}
            </div>
            {candidate.state === 'saved' && <div className="source-intake-file-actions"><MemoryReview vaultPath={vaultPath} sourcePath={candidate.sourcePath} /></div>}
            {candidate.error && <p className="source-intake-file-error">{candidate.error}</p>}
          </li>)}
          {!visible.length && <li className="source-intake-empty">{completed.length ? 'All files have been reviewed.' : 'Your selected files will appear here.'}</li>}
        </ul>
        <footer className="source-intake-footer"><span>Original files are preserved. Pending imports stay on this device.</span><Button variant="ghost" onClick={() => setOpen(false)}>Done</Button></footer>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(item)} onOpenChange={value => { if (!value && item?.state !== 'saving') setReview(null) }}>
      <DialogContent className="source-intake-dialog source-intake-review">
        <DialogHeader className="source-intake-header"><DialogTitle>Check imported text</DialogTitle><DialogDescription className="source-intake-review-filename" title={item?.name}>
          {item?.name}
        </DialogDescription></DialogHeader>
        <div className="source-intake-pages">
          {item?.source?.pages.map((page, index) => <section key={index}><h3>Page {index + 1}</h3>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">{page || 'No text on this page.'}</pre></section>)}
        </div>
        <p className="source-intake-review-hint">Your original file is preserved. Knowledge changes will need a separate review.</p>
        {item?.error && <p role="alert" className="break-words text-sm text-destructive">{item.error}</p>}
        <div className="source-intake-footer source-intake-review-footer">
          <Button variant="ghost" disabled={item?.state === 'saving'} onClick={() => { if (item) void patch(item.id, { state: 'rejected', source: undefined, file: undefined }).catch(() => undefined); setReview(null) }}>Skip file</Button>
          <Button variant="outline" disabled={item?.state !== 'review'} onClick={() => { if (item) void apply(item) }}>Import only</Button>
          <Button disabled={item?.state !== 'review'} onClick={() => { if (item) void apply(item, true) }}>{item?.state === 'saving' ? 'Importing…' : 'Import & build knowledge'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>
}
