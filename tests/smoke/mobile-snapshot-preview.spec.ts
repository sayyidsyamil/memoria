import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'

const require = createRequire(import.meta.url)
const { buildCooperativeWorkspaceSnapshot }: typeof import('../../apps/mobile/src/workspace/cooperativeWorkspaceSnapshot') =
  require('../../apps/mobile/src/workspace/cooperativeWorkspaceSnapshot')
const { readWorkspaceSnapshotPreview }: typeof import('../../apps/mobile/src/workspace/workspaceSnapshotPreview') =
  require('../../apps/mobile/src/workspace/workspaceSnapshotPreview')
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const timestamp = new Date(1792000000000)

test('@smoke mobile cached presentation never replaces fresh vault sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memoria-snapshot-preview-'))
  try {
    const fixture = await createFixture(root)
    const { index, storage, target } = fixture
    const initial = await index()
    await buildCooperativeWorkspaceSnapshot(initial, undefined, { storage })
    const original = await readFile(target, 'utf8'), originalStat = await stat(target)
    const changed = original.replace('Original', 'Changed!')
    await writeFile(target, changed)
    await utimes(target, timestamp, timestamp)
    const changedStat = await stat(target)
    expect(changedStat.size).toBe(originalStat.size)
    expect(changedStat.mtimeMs).toBe(originalStat.mtimeMs)
    const preview = await readWorkspaceSnapshotPreview({ vaultPath: initial.vaultPath, vaultLabel: initial.vaultLabel, maxNotes: initial.maxNotes }, storage)
    expect(preview?.kind).toBe('provisional')
    expect(preview?.allNotes.find(note => note.id === 'note-0.md')?.title).toBe('Original 0')
    expect(preview).not.toHaveProperty('sync')
    expect(preview?.notes[0]).not.toHaveProperty('rawContent')
    let hit: boolean | undefined
    const current = await buildCooperativeWorkspaceSnapshot(await index(), undefined, { storage, onCache: value => { hit = value } })
    expect(hit).toBe(false)
    expect(current.notes.find(note => note.id === 'note-0.md')?.rawContent).toBe(changed)
    expect(await readFile(target, 'utf8')).toBe(changed)
    expect((await stat(target)).mtimeMs).toBe(changedStat.mtimeMs)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function createFixture(root: string) {
  const vault = join(root, 'vault'), cache = join(root, 'cache')
  await mkdir(vault)
  await mkdir(cache)
  const names = Array.from({ length: 129 }, (_, index) => `note-${index}.md`)
  await Promise.all(names.map(async (name, index) => {
    await writeFile(join(vault, name), `---\ntype: Note\ncustom: preserved\n---\n# Original ${index}\n`)
    await utimes(join(vault, name), timestamp, timestamp)
  }))
  const index = async () => ({ vaultPath: pathToFileURL(vault).href, vaultLabel: 'Owned QA fixture', maxNotes: names.length, files: await Promise.all(names.map(async relativePath => {
    const absolutePath = join(vault, relativePath), content = await readFile(absolutePath, 'utf8'), metadata = await stat(absolutePath)
    return { absolutePath, relativePath, content, contentDigest: hash(content),
      createdAt: metadata.birthtimeMs, modifiedAt: metadata.mtimeMs, size: metadata.size }
  })) })
  const storage = { revision: 'smoke:1', digest: async (text: string) => hash(text),
    read: async (key: string) => readFile(join(cache, key), 'utf8').catch(() => null),
    write: async (key: string, value: string) => { await writeFile(join(cache, key), value) } }
  return { target: join(vault, names[0]), index, storage }
}
