import fs from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import git from 'isomorphic-git'
import { afterEach, expect, it } from 'vitest'
import { createGitVault } from './gitVault'

const author = { name: 'Merge QA', email: 'qa@example.invalid' }
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function fixture(base: string | Uint8Array, ours: string | Uint8Array, theirs: string | Uint8Array) {
  const dir = await mkdtemp(join(tmpdir(), 'memoria-merge-'))
  roots.push(dir)
  const context = { fs, dir }
  const vault = createGitVault(context)
  await git.init({ ...context, defaultBranch: 'main' })
  await writeFile(join(dir, 'note.md'), base)
  await vault.checkpoint(author)
  await git.branch({ ...context, ref: 'remote' })
  await writeFile(join(dir, 'note.md'), ours)
  const local = await vault.checkpoint(author)
  await git.checkout({ ...context, ref: 'remote' })
  await writeFile(join(dir, 'note.md'), theirs)
  const remote = await vault.checkpoint(author, 'Remote test change')
  await git.checkout({ ...context, ref: 'main' })
  return { context, vault, local: local.oid, remote: remote.oid, note: join(dir, 'note.md') }
}

const base = '---\nstatus: draft\ncustom: keep\n---\n# Title\n\nFirst paragraph\n\nLast paragraph\n'
const localText = base.replace('First paragraph', 'Local paragraph')
const remoteText = base.replace('Last paragraph', 'Remote paragraph')
const mergedText = localText.replace('Last paragraph', 'Remote paragraph')

it('merges nonoverlapping edits in the same note without dropping frontmatter', async () => {
  const { vault, remote, note } = await fixture(base, localText, remoteText)
  expect(await vault.integrate(remote, author)).toBe('merged')
  expect(await readFile(note, 'utf8')).toBe(mergedText)
})

it('converges identical concurrent edits without a conflict', async () => {
  const { vault, context, remote, note } = await fixture(base, localText, localText)
  await writeFile(join(context.dir, 'local.md'), 'local')
  await vault.checkpoint(author)
  expect(await vault.integrate(remote, author)).not.toBe('diverged')
  expect(await readFile(note, 'utf8')).toBe(localText)
})

it('keeps HEAD, index and working bytes intact when edits conflict', async () => {
  const { vault, context, remote, local, note } = await fixture(base, localText, base.replace('First paragraph', 'Other paragraph'))
  const index = await readFile(join(context.dir, '.git', 'index'))
  expect(await vault.integrate(remote, author)).toBe('diverged')
  expect(await git.resolveRef({ ...context, ref: 'HEAD' })).toBe(local)
  expect(await readFile(join(context.dir, '.git', 'index'))).toEqual(index)
  expect(await readFile(note, 'utf8')).toBe(localText)
})

it.each([0, 255])('never text-merges binary or invalid UTF-8 bytes (%s)', async byte => {
  const content = (text: string) => Buffer.concat([Buffer.from([byte]), Buffer.from(text)])
  const ours = content(localText)
  const { vault, context, remote, local, note } = await fixture(content(base), ours, content(remoteText))
  expect(await vault.integrate(remote, author)).toBe('diverged')
  expect(await git.resolveRef({ ...context, ref: 'HEAD' })).toBe(local)
  expect(await readFile(note)).toEqual(ours)
})

it('preserves delete-versus-edit conflicts without resurrecting or discarding content', async () => {
  const { vault, context, remote, note } = await fixture(base, localText, remoteText)
  await rm(note)
  const local = await vault.checkpoint(author)
  expect(await vault.integrate(remote, author)).toBe('diverged')
  expect(await git.resolveRef({ ...context, ref: 'HEAD' })).toBe(local.oid)
  await expect(readFile(note)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('recovers an interrupted merge checkout before any subsequent checkpoint', async () => {
  const { vault, context, remote, local, note } = await fixture(base, localText, remoteText)
  const interrupted = { promises: { ...fs.promises, writeFile: async (...args: Parameters<typeof fs.promises.writeFile>) => {
    if (String(args[0]) === note) throw new Error('simulatedDiskFailure')
    return fs.promises.writeFile(...args)
  } } }
  await expect(createGitVault({ ...context, fs: interrupted }).integrate(remote, author)).rejects.toMatchObject({
    code: 'MultipleGitError', errors: [expect.objectContaining({ message: 'simulatedDiskFailure' })],
  })
  expect(await git.resolveRef({ ...context, ref: 'HEAD' })).toBe(local)
  const checkpoint = await vault.checkpoint(author)
  expect(checkpoint.changedFiles).toBe(0)
  expect((await git.readCommit({ ...context, oid: checkpoint.oid })).commit.parent).toEqual([local, remote])
  expect(await readFile(note, 'utf8')).toBe(mergedText)
})
