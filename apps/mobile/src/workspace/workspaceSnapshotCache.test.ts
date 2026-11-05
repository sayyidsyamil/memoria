import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import * as parser from './localVaultSnapshot'
import type { LocalVaultFile, LocalVaultSnapshotOptions } from './localVaultSnapshot'
import { buildCooperativeWorkspaceSnapshot } from './cooperativeWorkspaceSnapshot'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const now = 1_792_000_000_000
const file = (relativePath: string, content: string): LocalVaultFile => ({ relativePath, content,
  contentDigest: hash(content), absolutePath: `file:///fixture/${relativePath}`, createdAt: now - 7_200_000,
  modifiedAt: now - 3_600_000, size: content.length })

function options(): LocalVaultSnapshotOptions {
  return { files: [
    file('types/Essay.md', '---\ntype: Type\ncolor: green\n---\n# Essay\n'),
    file('target.md', '---\ntype: Project\naliases: [Destination]\n---\n# Target\n'),
    file('views/essays.yml', 'name: Essays\nfilters:\n  all:\n    - field: type\n      op: equals\n      value: Essay\n'),
    ...Array.from({ length: 130 }, (_, n) => file(`essay-${n}.md`, `---\ntype: Essay\ncustom: keep\nrelated_to: ["[[Destination]]"]\n---\n# Essay ${n}\n\nBody **bold**.\n`)),
  ], folderPaths: ['types', 'views'], vaultLabel: 'Fixture', vaultAlias: 'fixture', vaultPath: 'file:///fixture' }
}

function storage() {
  const files = new Map<string, string>()
  return { files, digest: vi.fn(async (text: string) => hash(text)),
    read: vi.fn(async (key: string) => files.get(key) ?? null),
    write: vi.fn(async (key: string, value: string) => { files.set(key, value) }) }
}

afterEach(() => vi.restoreAllMocks())

it('reuses a persisted snapshot for an independently rebuilt fresh index without running the parser', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const disk = storage()
  const input = options()
  const first = await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: disk })
  const parse = vi.spyOn(parser, 'localVaultWorkspaceSnapshotSteps')
  const hit = vi.fn()
  const restored = await buildCooperativeWorkspaceSnapshot(structuredClone(input), undefined, { storage: disk, onCache: hit })
  expect(hit).toHaveBeenCalledWith(true)
  expect(parse).not.toHaveBeenCalled()
  expect(restored).toEqual(first)
  expect(disk.write).toHaveBeenCalledTimes(1)
  expect(restored.typeDefinitions?.Essay.rawContent).toContain('color: green')
  expect(restored.notes.find(note => note.id === 'essay-0.md')?.rawContent).toContain('custom: keep')
})

it('invalidates a rapid equal-length same-timestamp content edit', async () => {
  const disk = storage(), input = options()
  await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: disk })
  const old = input.files[3]
  input.files[3] = { ...old, content: old.content.replace('Essay 0', 'Essay X') }
  input.files[3].contentDigest = hash(input.files[3].content)
  const hit = vi.fn()
  const next = await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: disk, onCache: hit })
  expect(hit).toHaveBeenCalledWith(false)
  expect(next.allNotes?.find(note => note.id === old.relativePath)?.title).toBe('Essay X')
  expect(input.files[3].modifiedAt).toBe(old.modifiedAt)
  expect(input.files[3].size).toBe(old.size)
})

it('refreshes type definitions, view filters and relationship targets from changed bytes', async () => {
  const disk = storage(), input = options()
  await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: disk })
  input.files[0] = file('types/Essay.md', input.files[0].content.replace('green', 'red'))
  input.files[1] = file('target.md', input.files[1].content.replace('# Target', '# Destination renamed'))
  input.files[2] = file('views/essays.yml', input.files[2].content.replace('value: Essay', 'value: Project'))
  const next = await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: disk })
  expect(next.allNotes?.find(note => note.id === 'essay-0.md')?.typeTone).toBe('red')
  expect(next.allNotes?.find(note => note.id === 'essay-0.md')?.relationships[0].values[0].title).toBe('Destination renamed')
  expect(next).toEqual(parser.buildLocalVaultWorkspaceSnapshot(input))
})

it.each(inputChanges())('invalidates changed snapshot input: $label', async ({ mutate }) => {
  const disk = storage(), input = options()
  await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: disk })
  mutate(input)
  const hit = vi.fn()
  const next = await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: disk, onCache: hit })
  expect(hit).toHaveBeenCalledWith(false)
  expect(next).toEqual(parser.buildLocalVaultWorkspaceSnapshot(input))
})

it('recalculates clock-dependent labels without rebuilding the unchanged graph', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  const disk = storage(), input = options()
  await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: disk })
  clock.mockReturnValue(now + 86_400_000)
  const hit = vi.fn()
  const next = await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: disk, onCache: hit })
  expect(hit).toHaveBeenCalledWith(true)
  expect(next.allNotes?.[0].modified).toBe('25h ago')
  expect(next).toEqual(parser.buildLocalVaultWorkspaceSnapshot(input))
})

it('does not reuse a snapshot produced by another native release build', async () => {
  const disk = storage(), input = options(), hit = vi.fn()
  await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: { ...disk, revision: '1.0:123' } })
  await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: { ...disk, revision: '1.0:124' }, onCache: hit })
  expect(hit).toHaveBeenCalledWith(false)
})

it.each(['constructor', '__proto__', 'toString'])('keeps custom type %s serializable instead of reading inherited fallback members', async name => {
  const disk = storage(), input = options()
  input.files[3] = file('essay-0.md', `---\ntype: ${name}\n---\n# Custom type\n`)
  const first = await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: disk })
  expect(first.allNotes?.find(note => note.id === 'essay-0.md')?.typeTone).toBe('gray')
  const hit = vi.fn()
  const next = await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: disk, onCache: hit })
  expect(hit).toHaveBeenCalledWith(true)
  expect(next).toEqual(first)
})

it('never saves later in-memory edits into an already persisted cache entry', async () => {
  const disk = storage(), input = options()
  const first = await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: disk })
  const original = first.notes[0].rawContent
  first.notes[0].rawContent = '# Unsaved change'
  const next = await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: disk })
  expect(next.notes[0].rawContent).toBe(original)
})

it.each(['malformed', 'checksum', 'version', 'shape'])('treats %s cache corruption as a miss and repairs the disposable cache', async corruption => {
  const disk = storage(), input = options()
  await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: disk })
  const [key, value] = [...disk.files][0]
  const record = JSON.parse(value)
  if (corruption === 'checksum') record.payload = record.payload.replace('keep', 'lost')
  if (corruption === 'version') record.version = -1
  if (corruption === 'shape') { record.payload = '[]'; record.checksum = hash(JSON.stringify([record.version, record.identity, record.input, record.payload])) }
  disk.files.set(key, corruption === 'malformed' ? '{broken' : JSON.stringify(record))
  const hit = vi.fn()
  const next = await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: disk, onCache: hit })
  expect(hit).toHaveBeenCalledWith(false)
  expect(next).toEqual(parser.buildLocalVaultWorkspaceSnapshot(input))
  await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: disk, onCache: hit })
  expect(hit).toHaveBeenLastCalledWith(true)
})

it.each(['read', 'write', 'digest'] as const)('keeps cache %s failures separate from authoritative vault opening', async operation => {
  const disk = storage(), input = options()
  disk[operation].mockRejectedValue(new Error('Cache unavailable'))
  expect(await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: disk })).toEqual(parser.buildLocalVaultWorkspaceSnapshot(input))
})

it.each(['note', 'type'])('independently checks cached editable %s text against the fresh index', async target => {
  const disk = storage(), input = options()
  await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: disk })
  const [key, value] = [...disk.files][0], record = JSON.parse(value), snapshot = JSON.parse(record.payload)
  if (target === 'note') snapshot.notes[0].rawContent = '# Stale editor source'
  else snapshot.typeDefinitions.Essay.rawContent = '# Stale type source'
  record.payload = JSON.stringify(snapshot)
  record.checksum = hash(JSON.stringify([record.version, record.identity, record.input, record.payload]))
  disk.files.set(key, JSON.stringify(record))
  const hit = vi.fn()
  const next = await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: disk, onCache: hit })
  expect(hit).toHaveBeenCalledWith(false)
  expect(next).toEqual(parser.buildLocalVaultWorkspaceSnapshot(input))
})

it('does not trust an older native index without fresh content digests', async () => {
  const disk = storage(), input = options()
  for (const entry of input.files) delete entry.contentDigest
  const next = await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: disk })
  expect(disk.read).not.toHaveBeenCalled()
  expect(disk.write).not.toHaveBeenCalled()
  expect(next).toEqual(parser.buildLocalVaultWorkspaceSnapshot(input))
})

it('does not publish a cached snapshot after its load was cancelled', async () => {
  const disk = storage(), input = options(), controller = new AbortController()
  await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: disk })
  const read = disk.read.getMockImplementation()
  disk.read.mockImplementation(async key => { controller.abort(); return read?.(key) ?? null })
  await expect(buildCooperativeWorkspaceSnapshot(input, controller.signal, { storage: disk })).rejects.toThrow('workspaceLoadCancelled')
})

function inputChanges() {
  const changes: [string, (input: LocalVaultSnapshotOptions) => void][] = [
    ['folder', input => { input.folderPaths?.push('new') }], ['rename', input => { input.files[3].relativePath = 'renamed.md' }],
    ['delete', input => { input.files.pop() }], ['created', input => { input.files[3].createdAt = now }],
    ['modified', input => { input.files[3].modifiedAt = now }], ['size', input => { input.files[3].size++ }],
    ['kind', input => { input.files[3].fileKind = 'text' }], ['label', input => { input.vaultLabel = 'Renamed' }],
    ['alias', input => { input.vaultAlias = 'different' }], ['root', input => { input.vaultPath = 'file:///other' }],
    ['preview', input => { input.maxNotes = 0 }], ['config', input => { input.vaultConfig = { defaultNoteWidth: 'wide' } }],
  ]
  return changes.map(([label, mutate]) => ({ label, mutate }))
}
