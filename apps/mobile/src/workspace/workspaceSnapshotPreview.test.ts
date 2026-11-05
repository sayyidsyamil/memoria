import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { buildCooperativeWorkspaceSnapshot } from './cooperativeWorkspaceSnapshot'
import type { LocalVaultFile, LocalVaultSnapshotOptions } from './localVaultSnapshot'
import { readWorkspaceSnapshotPreview } from './workspaceSnapshotPreview'
import { openWorkspaceSnapshotCache } from './workspaceSnapshotCache'

const now = 1_792_000_000_000
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const file = (path: string, content: string): LocalVaultFile => ({ relativePath: path, content, contentDigest: hash(content),
  absolutePath: `file:///preview-fixture/${path}`, createdAt: now - 7200000, modifiedAt: now - 3600000, size: content.length })

function options(): LocalVaultSnapshotOptions {
  return { vaultPath: 'file:///preview-fixture', vaultAlias: 'preview', vaultLabel: 'Preview fixture', folderPaths: ['types'],
    files: [file('types/Essay.md', '---\ntype: Type\ncolor: green\ntemplate: Private template\n---\n# Essay\n'),
      ...Array.from({ length: 130 }, (_, index) => file(`essay-${index}.md`, `---\ntype: Essay\ncustom: preserved\n---\n# Essay ${index}\n\nA **preview**.\n`))] }
}

function storage() {
  const files = new Map<string, string>()
  return { revision: '1.0:123', files, digest: vi.fn(async (text: string) => hash(text)),
    read: vi.fn(async (key: string) => files.get(key) ?? null),
    write: vi.fn(async (key: string, value: string) => { files.set(key, value) }) }
}

async function fixture() {
  const disk = storage(), input = options()
  const snapshot = await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: disk })
  disk.write.mockClear()
  return { disk, input, snapshot }
}

function identity(input: LocalVaultSnapshotOptions) {
  return { vaultPath: input.vaultPath, vaultAlias: input.vaultAlias, vaultLabel: input.vaultLabel,
    vaultConfig: input.vaultConfig, maxNotes: input.maxNotes }
}

type StoredRecord = { version: number; identity: string; input: string; payload: string; checksum: string }
const identityChanges: [string, (next: ReturnType<typeof identity>, disk: ReturnType<typeof storage>) => void][] = [
  ['root', next => { next.vaultPath = 'file:///other-root' }],
  ['alias', next => { next.vaultAlias = 'other-alias' }],
  ['label', next => { next.vaultLabel = 'Other label' }],
  ['revision', (_next, disk) => { disk.revision = '1.0:124' }],
  ['limit', next => { next.maxNotes = 1 }],
]
const corruptions: [string, (record: StoredRecord) => string][] = [
  ['malformed', () => '{broken'],
  ['version', record => JSON.stringify({ ...record, version: -1 })],
  ['payload', record => JSON.stringify({ ...record, payload: record.payload.replace('preserved', 'changed') })],
  ['input', record => JSON.stringify({ ...record, input: '0'.repeat(64) })],
  ['shape', record => withPayload(record, '[]')],
  ['oversized', () => 'x'.repeat(17 * 1024 * 1024)],
]

function withPayload(record: StoredRecord, payload: string) {
  const checksum = hash(JSON.stringify([record.version, record.identity, record.input, payload]))
  return JSON.stringify({ ...record, payload, checksum })
}

afterEach(() => vi.restoreAllMocks())

it('loads source-free provisional metadata before any authoritative file index is available', async () => {
  const { disk, input, snapshot } = await fixture()
  const preview = await readWorkspaceSnapshotPreview(identity(input), disk)
  expect(preview).toMatchObject({ kind: 'provisional', source: snapshot.source, sidebarSections: snapshot.sidebarSections })
  if (!preview) throw new Error('Preview missing')
  expect(preview.notes[0].title).toBe(snapshot.notes[0].title)
  expect(preview.allNotes.length).toBe(snapshot.allNotes?.length)
  expect(disk.write).not.toHaveBeenCalled()
})

it('cannot supply editable note/type sources, document blocks or sync authority', async () => {
  const { disk, input } = await fixture()
  const preview = await readWorkspaceSnapshotPreview(identity(input), disk)
  if (!preview) throw new Error('Preview missing')
  for (const key of ['sync', 'editorBlocks', 'editorBullets', 'input']) expect(preview).not.toHaveProperty(key)
  expect(preview.notes.length).toBeGreaterThan(0)
  for (const note of preview.notes.concat(preview.allNotes)) {
    expect(note).not.toHaveProperty('rawContent')
    expect(note).not.toHaveProperty('editorBlocks')
    expect(note).not.toHaveProperty('editorBullets')
  }
  expect(preview.typeDefinitions.Essay).toBeDefined()
  for (const type of Object.values(preview.typeDefinitions)) {
    expect(type).not.toHaveProperty('rawContent')
    expect(type).not.toHaveProperty('template')
  }
  expect(disk.write).not.toHaveBeenCalled()
})

it.each(identityChanges)('declines a different presentation identity: %s', async (_field, change) => {
  const { disk, input } = await fixture(), next = identity(input)
  change(next, disk)
  expect(await readWorkspaceSnapshotPreview(next, disk)).toBeNull()
  expect(disk.write).not.toHaveBeenCalled()
})

it('keeps source-free navigation across config changes without accepting an editable cache hit', async () => {
  const { disk, input, snapshot } = await fixture()
  const changed = { ...input, vaultConfig: { defaultNoteWidth: 'wide' as const } }
  const preview = await readWorkspaceSnapshotPreview(identity(changed), disk)
  if (!preview) throw new Error('Preview missing')
  expect(preview.kind).toBe('provisional')
  expect(preview.source).toEqual(snapshot.source)
  expect(preview.allNotes.length).toBe(snapshot.allNotes?.length)
  expect(preview.vaultConfig).toMatchObject({ defaultNoteWidth: 'wide' })
  expect(preview).not.toHaveProperty('sync')
  for (const note of preview.notes) expect(note).not.toHaveProperty('rawContent')
  for (const type of Object.values(preview.typeDefinitions)) expect(type).not.toHaveProperty('template')
  expect((await openWorkspaceSnapshotCache(changed, disk)).snapshot).toBeNull()
  expect(disk.write).not.toHaveBeenCalled()
})

it.each(corruptions)('fails closed on %s corruption', async (_label, corrupt) => {
  const { disk, input } = await fixture(), key = hash(input.vaultPath)
  const record = JSON.parse(disk.files.get(key) ?? '')
  disk.files.set(key, corrupt(record))
  expect(await readWorkspaceSnapshotPreview(identity(input), disk)).toBeNull()
  expect(disk.write).not.toHaveBeenCalled()
})

it.each(['null', '{}', '[]', '"not an identity"'])('rejects malformed identity %s even with a valid checksum', async encoded => {
  const { disk, input } = await fixture(), key = hash(input.vaultPath)
  const record: StoredRecord = JSON.parse(disk.files.get(key) ?? '')
  record.identity = encoded
  disk.files.set(key, withPayload(record, record.payload))
  expect(await readWorkspaceSnapshotPreview(identity(input), disk)).toBeNull()
})

it('does not turn a valid stale preview into an authoritative cache hit after an equal-stat edit', async () => {
  const { disk, input } = await fixture()
  const previous = input.files[1]
  input.files[1] = { ...previous, content: previous.content.replace('Essay 0', 'Essay X') }
  input.files[1].contentDigest = hash(input.files[1].content)
  const preview = await readWorkspaceSnapshotPreview(identity(input), disk)
  expect(preview?.allNotes?.find(note => note.id === previous.relativePath)?.title).toBe('Essay 0')
  const onCache = vi.fn()
  const fresh = await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: disk, onCache })
  expect(onCache).toHaveBeenCalledWith(false)
  expect(fresh.allNotes?.find(note => note.id === previous.relativePath)?.title).toBe('Essay X')
})

it.each(['source', 'arrays', 'note', 'null'])('checks decoded %s shape even with a valid envelope checksum', async corruption => {
  const { disk, input } = await fixture(), key = hash(input.vaultPath)
  const record = JSON.parse(disk.files.get(key) ?? ''), snapshot = JSON.parse(record.payload)
  if (corruption === 'source') snapshot.source.vaultPath = 'file:///other-root'
  if (corruption === 'arrays') snapshot.allNotes = null
  if (corruption === 'note') snapshot.notes[0] = null
  record.payload = JSON.stringify(corruption === 'null' ? null : snapshot)
  record.checksum = hash(JSON.stringify([record.version, record.identity, record.input, record.payload]))
  disk.files.set(key, JSON.stringify(record))
  expect(await readWorkspaceSnapshotPreview(identity(input), disk)).toBeNull()
})

it.each(['oversized', 'nonfinite'])('keeps the last valid cache when a %s snapshot cannot be saved', async failure => {
  const { disk, input, snapshot } = await fixture(), key = hash(input.vaultPath)
  const original = disk.files.get(key), cache = await openWorkspaceSnapshotCache(input, disk)
  const next = structuredClone(snapshot)
  if (failure === 'nonfinite') next.sync.minutesAgo = Infinity
  else next.notes[0].rawContent = 'x'.repeat(8 * 1024 * 1024 + 1)
  await cache.save(next)
  expect(disk.write).not.toHaveBeenCalled()
  expect(disk.files.get(key)).toBe(original)
  expect(await readWorkspaceSnapshotPreview(identity(input), disk)).not.toBeNull()
})

it('refreshes relative dates and never persists consumer changes', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  const { disk, input } = await fixture()
  clock.mockReturnValue(now + 86400000)
  const preview = await readWorkspaceSnapshotPreview(identity(input), disk)
  expect(preview?.notes[0].modified).toBe('25h ago')
  if (preview) preview.notes[0].title = 'Not saved'
  const next = await readWorkspaceSnapshotPreview(identity(input), disk)
  expect(next?.notes[0].title).not.toBe('Not saved')
  expect(disk.write).not.toHaveBeenCalled()
})

it.each(['digest', 'read'] as const)('treats cache %s failure as no preview, not a vault-open failure', async operation => {
  const { disk, input } = await fixture()
  disk[operation].mockRejectedValue(new Error('Cache unavailable'))
  expect(await readWorkspaceSnapshotPreview(identity(input), disk)).toBeNull()
})

it('does not return a preview after cancellation during cache IO', async () => {
  const { disk, input } = await fixture(), controller = new AbortController()
  const read = disk.read.getMockImplementation()
  disk.read.mockImplementation(async key => { controller.abort(); return read?.(key) ?? null })
  expect(await readWorkspaceSnapshotPreview(identity(input), disk, controller.signal)).toBeNull()
})

it('does not access cache storage when already cancelled or unsupported', async () => {
  const disk = storage(), controller = new AbortController()
  controller.abort()
  expect(await readWorkspaceSnapshotPreview(identity(options()), disk, controller.signal)).toBeNull()
  expect(disk.read).not.toHaveBeenCalled()
  expect(disk.digest).not.toHaveBeenCalled()
  expect(await readWorkspaceSnapshotPreview(identity(options()), null)).toBeNull()
})
