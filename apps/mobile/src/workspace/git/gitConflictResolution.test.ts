import fs from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import git from 'isomorphic-git'
import { afterEach, expect, it } from 'vitest'
import { createGitVault } from './gitVault'
import { inspectGitConflicts, resolveGitConflicts } from './gitConflictResolution'

const author = { name: 'Conflict QA', email: 'qa@example.invalid' }
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
type Files = Record<string, string | Uint8Array>

async function divergent(base: Files, local: Files, remote: Files) {
  const dir = await mkdtemp(join(tmpdir(), 'memoria-conflict-'))
  roots.push(dir)
  const context = { fs, dir }
  const vault = createGitVault(context)
  const write = async (files: Files) => {
    const roots = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)].map(path => path.split('/')[0]))
    for (const path of roots) await rm(join(dir, path), { recursive: true, force: true })
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, path)), { recursive: true })
      await writeFile(join(dir, path), content)
    }
    return (await vault.checkpoint(author)).oid
  }
  await git.init({ ...context, defaultBranch: 'main' })
  await write(base)
  await git.branch({ ...context, ref: 'other' })
  await write(local)
  await git.checkout({ ...context, ref: 'other' })
  const theirs = await write(remote)
  await git.checkout({ ...context, ref: 'main', noCheckout: true })
  const ours = await write(local)
  const status = await git.statusMatrix(context)
  expect(status.filter(([, h, w, s]) => h !== w || h !== s)).toEqual([])
  await git.writeRef({ ...context, ref: 'refs/remotes/origin/main', value: theirs })
  return { context, ours, theirs, vault }
}

it('resolves explicit choices, keeps unrelated edits, and preserves both parents', async () => {
  const state = await divergent({ 'n.md': 'base', 'b.md': 'first\n\nmiddle\n\nlast\n' },
    { 'n.md': 'ours', 'b.md': 'local\n\nmiddle\n\nlast\n' },
    { 'n.md': 'theirs', 'b.md': 'first\n\nmiddle\n\nremote\n' })
  const review = await inspectGitConflicts(state.context)
  expect(review.files.map(file => file.path)).toEqual(['n.md'])
  expect(review.files[0].local.text).toBe('ours')
  expect(review.files[0].remote.text).toBe('theirs')
  const oid = await resolveGitConflicts(state.context, review, { 'n.md': 'remote' }, author)
  expect((await git.readCommit({ ...state.context, oid })).commit.parent).toEqual([state.ours, state.theirs])
  expect(await readFile(join(state.context.dir, 'n.md'), 'utf8')).toBe('theirs')
  expect(await readFile(join(state.context.dir, 'b.md'), 'utf8')).toBe('local\n\nmiddle\n\nremote\n')
  expect((await git.statusMatrix(state.context)).every(([, h, w, s]) => h === w && h === s)).toBe(true)
})

it('keeps both binary files without overwriting an existing sibling', async () => {
  const state = await divergent({ 'a.bin': new Uint8Array([0, 1]) },
    { 'a.bin': new Uint8Array([0, 2]), 'a (conflict 1).bin': 'existing' },
    { 'a.bin': new Uint8Array([0, 3]) })
  const review = await inspectGitConflicts(state.context)
  expect(review.files[0].local.kind).toBe('binary')
  await resolveGitConflicts(state.context, review, { 'a.bin': 'both' }, author)
  expect(await readFile(join(state.context.dir, 'a.bin'))).toEqual(Buffer.from([0, 2]))
  expect(await readFile(join(state.context.dir, 'a (conflict 2).bin'))).toEqual(Buffer.from([0, 3]))
  expect(await readFile(join(state.context.dir, 'a (conflict 1).bin'), 'utf8')).toBe('existing')
})

it('requires every conflict choice before publishing any file', async () => {
  const state = await divergent({ 'n.md': 'base' }, { 'n.md': 'ours' }, { 'n.md': 'theirs' })
  await expect(resolveGitConflicts(state.context, await inspectGitConflicts(state.context), {}, author)).rejects.toThrow('syncConflictUnresolved')
  expect(await git.resolveRef({ ...state.context, ref: 'HEAD' })).toBe(state.ours)
})

it.each(['workingCopy', 'head', 'remote'] as const)('rejects a stale %s comparison without losing edits', async changed => {
  const state = await divergent({ 'n.md': 'base' }, { 'n.md': 'ours' }, { 'n.md': 'theirs' })
  const review = await inspectGitConflicts(state.context)
  if (changed === 'remote') await git.writeRef({ ...state.context, ref: 'refs/remotes/origin/main', value: state.ours, force: true })
  else {
    await writeFile(join(state.context.dir, 'n.md'), 'new editing')
    if (changed === 'head') await state.vault.checkpoint(author)
  }
  const before = await readFile(join(state.context.dir, 'n.md'))
  await expect(resolveGitConflicts(state.context, review, { 'n.md': 'remote' }, author)).rejects.toThrow('syncConflictStale')
  expect(await readFile(join(state.context.dir, 'n.md'))).toEqual(before)
})

it('handles deletion versus edit and file versus directory without swallowing children', async () => {
  const state = await divergent({ 'n.md': 'base', 'item': 'file' },
    { 'item': 'local file' }, { 'n.md': 'edited', 'item/child.md': 'remote child' })
  const review = await inspectGitConflicts(state.context)
  expect(review.files.map(file => file.path)).toEqual(['item', 'n.md'])
  await resolveGitConflicts(state.context, review, { 'item': 'both', 'n.md': 'remote' }, author)
  expect(await readFile(join(state.context.dir, 'item'), 'utf8')).toBe('local file')
  expect(await readFile(join(state.context.dir, 'item (conflict 1)/child.md'), 'utf8')).toBe('remote child')
  expect(await readFile(join(state.context.dir, 'n.md'), 'utf8')).toBe('edited')
})

it('offers explicit originals when a text-clean merge would corrupt metadata', async () => {
  const base = '---\nleft: 1\nseparator: preserved\nright: 2\n---\nBody\n'
  const ours = base.replace('left:', 'shared:')
  const state = await divergent({ 'n.md': base }, { 'n.md': ours }, { 'n.md': base.replace('right:', 'shared:') })
  const review = await inspectGitConflicts(state.context)
  expect(review.files.map(file => file.path)).toEqual(['n.md'])
  await resolveGitConflicts(state.context, review, { 'n.md': 'local' }, author)
  expect(await readFile(join(state.context.dir, 'n.md'), 'utf8')).toBe(ours)
})

it('publishes a chosen remote directory over a local file completely', async () => {
  const state = await divergent({ 'item': 'base' }, { 'item': 'local' }, { 'item/child.md': 'remote' })
  const review = await inspectGitConflicts(state.context)
  await resolveGitConflicts(state.context, review, { item: 'remote' }, author)
  expect(await readFile(join(state.context.dir, 'item/child.md'), 'utf8')).toBe('remote')
  expect((await git.statusMatrix(state.context)).every(([, h, w, s]) => h === w && h === s)).toBe(true)
})

it('publishes a chosen remote file over a local directory completely', async () => {
  const state = await divergent({ 'item/base.md': 'base' }, { 'item/base.md': 'local' }, { item: 'remote' })
  const review = await inspectGitConflicts(state.context)
  await resolveGitConflicts(state.context, review, { item: 'remote' }, author)
  expect(await readFile(join(state.context.dir, 'item'), 'utf8')).toBe('remote')
  expect((await git.statusMatrix(state.context)).every(([, h, w, s]) => h === w && h === s)).toBe(true)
})

it('recovers a file-to-directory publication after an interrupted write', async () => {
  const state = await divergent({ item: 'base' }, { item: 'local' }, { 'item/child.md': 'remote' })
  const review = await inspectGitConflicts(state.context)
  const interrupted = { ...state.context, fs: { promises: { ...fs.promises, writeFile: async (...args: Parameters<typeof fs.promises.writeFile>) => {
    if (String(args[0]).endsWith('/item/child.md')) throw new Error('simulated disk failure')
    return fs.promises.writeFile(...args)
  } } } }
  await expect(resolveGitConflicts(interrupted, review, { item: 'remote' }, author)).rejects.toThrow()
  await state.vault.recover()
  expect(await readFile(join(state.context.dir, 'item/child.md'), 'utf8')).toBe('remote')
  expect((await git.statusMatrix(state.context)).every(([, h, w, s]) => h === w && h === s)).toBe(true)
})
