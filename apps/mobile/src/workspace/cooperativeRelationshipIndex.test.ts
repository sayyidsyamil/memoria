import { afterEach, expect, it, vi } from 'vitest'
import { buildCooperativeWorkspaceSnapshot } from './cooperativeWorkspaceSnapshot'
import { localVaultWorkspaceSnapshotSteps, type LocalVaultFile } from './localVaultSnapshot'
import * as wikilinks from './mobileWikilinks'

afterEach(() => vi.restoreAllMocks())

function options(count = 6000, aliasesPerNote = 1) {
  const files = Array.from({ length: count }, (_, index) => file(index, aliasesPerNote))
  return { files, maxNotes: 0, vaultAlias: 'fixture', vaultLabel: 'Fixture', vaultPath: 'file:///fixture' }
}

function file(index: number, aliasesPerNote: number): LocalVaultFile {
  const aliases = Array.from({ length: aliasesPerNote }, (_, alias) => `Alias ${index}-${alias}`)
  return {
    absolutePath: `file:///fixture/notes/${index}.md`, relativePath: `notes/${index}.md`,
    content: `---\ntype: Note\naliases: ${JSON.stringify(aliases)}\n---\n# Note ${index}\n`,
    createdAt: index, modifiedAt: index, size: 80,
  }
}

it.each([
  { notes: 6000, aliases: 1, targets: 60_000 },
  { notes: 1, aliases: 6000, targets: 12_008 },
])('bounds relationship indexing for $notes notes with $aliases aliases each', ({ notes, aliases, targets }) => {
  const normalize = vi.spyOn(wikilinks, 'normalizeMobileWikilinkTarget')
  const work = localVaultWorkspaceSnapshotSteps(options(notes, aliases))
  let largestBatch = 0
  for (;;) {
    const before = normalize.mock.calls.length
    const next = work.next()
    largestBatch = Math.max(largestBatch, normalize.mock.calls.length - before)
    if (next.done) break
  }
  expect(normalize.mock.calls.length).toBe(targets)
  expect(largestBatch).toBeLessThanOrEqual(32)
})

it('delivers an input timer before finishing the relationship index', async () => {
  const normalizeTarget = wikilinks.normalizeMobileWikilinkTarget
  let indexed = 0
  let pulse: Promise<number> | undefined
  vi.spyOn(performance, 'now').mockImplementation(() => indexed)
  vi.spyOn(wikilinks, 'normalizeMobileWikilinkTarget').mockImplementation(value => {
    indexed++
    if (indexed === 1) pulse = new Promise(resolve => setTimeout(() => resolve(indexed), 0))
    return normalizeTarget(value)
  })
  await buildCooperativeWorkspaceSnapshot(options(100), undefined, { storage: null })
  expect(await pulse).toBeLessThan(1000)
})

it('stops normalization at the next bounded task when cancelled during index construction', async () => {
  const normalizeTarget = wikilinks.normalizeMobileWikilinkTarget
  const controller = new AbortController()
  let indexed = 0
  vi.spyOn(wikilinks, 'normalizeMobileWikilinkTarget').mockImplementation(value => {
    if (++indexed === 64) controller.abort()
    return normalizeTarget(value)
  })
  await expect(buildCooperativeWorkspaceSnapshot(options(), controller.signal, { storage: null }))
    .rejects.toThrow('workspaceLoadCancelled')
  expect(indexed).toBe(64)
})

it('preserves first-match precedence, alias scoping and unresolved relationship labels', async () => {
  const input = options(2)
  input.maxNotes = 3
  input.files[0].content = '---\ntype: Note\naliases: [Shared]\n---\n# First\n'
  input.files[1].content = '---\ntype: Note\naliases: [Shared]\n---\n# Second\n'
  input.files.push({ ...input.files[0], relativePath: 'source.md', absolutePath: 'file:///fixture/source.md',
    content: '---\nrelated_to: ["[[fixture/SHARED|Label]]", "[[Missing|Unresolved]]"]\n---\n# Source\n' })
  const snapshot = await buildCooperativeWorkspaceSnapshot(input, undefined, { storage: null })
  const relationships = snapshot.notes.find(note => note.id === 'source.md')?.relationships[0].values
  expect(relationships).toMatchObject([
    { id: 'notes/0.md', title: 'First', ref: '[[fixture/SHARED|Label]]' },
    { id: undefined, title: 'Unresolved', ref: '[[Missing|Unresolved]]' },
  ])
})
