import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import git from 'isomorphic-git'
import { afterEach, expect, it } from 'vitest'
import { createGitVault } from './gitVault'
import { gitTestEnvironment } from './gitTestServer'
import { stageVerifiedGitChanges } from './gitSelectiveStaging'

const author = { name: 'Test', email: 'qa@example.invalid' }
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function packedRepository() {
  const dir = await mkdtemp(join(tmpdir(), 'memoria-git-staging-'))
  roots.push(dir)
  await git.init({ fs, dir, defaultBranch: 'main' })
  await writeFile(join(dir, 'note.md'), '---\ncustom: original\n---\n# Original\n')
  await writeFile(join(dir, 'unchanged.md'), '# Packed and unchanged\n')
  await git.add({ fs, dir, filepath: '.' })
  await git.commit({ fs, dir, author, message: 'Fixture' })
  execFileSync('git', ['-C', dir, 'repack', '-ad'], { env: gitTestEnvironment() })
  return { fs, dir }
}

function looseObjectCount({ dir }: { dir: string }) {
  const report = execFileSync('git', ['-C', dir, 'count-objects', '-v'], { env: gitTestEnvironment(), encoding: 'utf8' })
  const count = /^count: (\d+)$/mu.exec(report)
  if (!count) throw new Error('Missing loose object count')
  return Number(count[1])
}

it('does not inflate packed, unchanged blobs into loose objects during a checkpoint', async () => {
  const context = await packedRepository()
  expect(looseObjectCount(context)).toBe(0)
  expect((await createGitVault(context).checkpoint(author)).changedFiles).toBe(0)
  expect(looseObjectCount(context)).toBe(0)
})

it('inspects unchanged working-tree metadata only once before staging', async () => {
  const context = await packedRepository()
  let inspections = 0
  const measuredFs = { promises: { ...fs.promises, lstat: async (path: fs.PathLike) => {
    if (String(path) === join(context.dir, 'note.md')) inspections++
    return fs.promises.lstat(path)
  } } }
  await stageVerifiedGitChanges({ ...context, fs: measuredFs })
  expect(inspections).toBe(1)
})

it('checkpoints a verified-clean tree without a second working-tree metadata scan', async () => {
  const context = await packedRepository()
  let inspections = 0
  const measuredFs = { promises: { ...fs.promises, lstat: async (path: fs.PathLike) => {
    if (String(path) === join(context.dir, 'note.md')) inspections++
    return fs.promises.lstat(path)
  } } }
  const vault = createGitVault({ ...context, fs: measuredFs })
  expect((await vault.checkpoint(author)).changedFiles).toBe(0)
  expect(inspections).toBe(1)
  inspections = 0
  expect((await vault.requireClean()).changedFiles).toBe(0)
  expect(inspections).toBe(1)
})

it('only reports a verified-clean tree when working bytes, index and HEAD all match', async () => {
  const context = await packedRepository()
  expect(await stageVerifiedGitChanges(context)).toBe(true)
  await writeFile(join(context.dir, 'note.md'), '# Already staged but not committed\n')
  await git.add({ ...context, filepath: 'note.md' })
  expect(await stageVerifiedGitChanges(context)).toBe(false)
  expect((await createGitVault(context).checkpoint(author)).changedFiles).toBe(1)
  expect(await stageVerifiedGitChanges(context)).toBe(true)
})

it('does not report deleted tracked files or untracked additions as clean', async () => {
  const context = await packedRepository()
  await rm(join(context.dir, 'note.md'))
  expect(await stageVerifiedGitChanges(context)).toBe(false)
  expect((await createGitVault(context).checkpoint(author)).changedFiles).toBe(1)
  await writeFile(join(context.dir, 'new.md'), '# Added\n')
  expect(await stageVerifiedGitChanges(context)).toBe(false)
})

it('keeps ignored untracked directories out of verified-clean status', async () => {
  const context = await packedRepository()
  await mkdir(join(context.dir, '.git/info'), { recursive: true })
  await writeFile(join(context.dir, '.git/info/exclude'), 'ignored/\n')
  await mkdir(join(context.dir, 'ignored'))
  await writeFile(join(context.dir, 'ignored/private.bin'), new Uint8Array([255, 0]))
  expect(await stageVerifiedGitChanges(context)).toBe(true)
  expect((await createGitVault(context).checkpoint(author)).changedFiles).toBe(0)
})

it('reads tracked blob bodies serially, not all files at once', async () => {
  const context = await packedRepository()
  let pending = 0
  let peak = 0
  const measuredFs = { promises: { ...fs.promises, readFile: async (path: fs.PathLike, options?: Parameters<typeof readFile>[1]) => {
    const filepath = relative(context.dir, String(path))
    if (!['note.md', 'unchanged.md'].includes(filepath)) return fs.promises.readFile(path, options)
    pending++
    peak = Math.max(peak, pending)
    try {
      await new Promise<void>((resolve) => setImmediate(resolve))
      return await fs.promises.readFile(path, options)
    } finally { pending-- }
  } } }
  await stageVerifiedGitChanges({ ...context, fs: measuredFs })
  expect(peak).toBe(1)
})

it('stages an edit and binary addition without rewriting unrelated packed blobs', async () => {
  const context = await packedRepository()
  const content = '---\ncustom: preserved\n---\n# Edited\n'
  const binary = Buffer.from([0, 255, 128, 10])
  await writeFile(join(context.dir, 'note.md'), content)
  await writeFile(join(context.dir, 'image.bin'), binary)
  const result = await createGitVault(context).checkpoint(author)
  expect(result.changedFiles).toBe(2)
  const note = await git.readBlob({ ...context, oid: result.oid, filepath: 'note.md' })
  expect(Buffer.from(note.blob).toString()).toBe(content)
  const image = await git.readBlob({ ...context, oid: result.oid, filepath: 'image.bin' })
  expect(Buffer.from(image.blob)).toEqual(binary)
  // Two changed blobs, one tree and one commit; no unrelated packed blob.
  expect(looseObjectCount(context)).toBe(4)
})

it('checkpoints a deletion without rewriting remaining packed files', async () => {
  const context = await packedRepository()
  await rm(join(context.dir, 'note.md'))
  const result = await createGitVault(context).checkpoint(author)
  expect(result.changedFiles).toBe(1)
  expect(await git.listFiles(context)).toEqual(['unchanged.md'])
  expect(looseObjectCount(context)).toBe(2)
})

it('retains configured line-ending normalization rather than hashing raw bytes as staged content', async () => {
  const context = await packedRepository()
  await git.setConfig({ ...context, path: 'core.autocrlf', value: 'true' })
  await writeFile(join(context.dir, 'note.md'), '# Windows\r\nSecond line\r\n')
  const result = await createGitVault(context).checkpoint(author)
  const note = await git.readBlob({ ...context, oid: result.oid, filepath: 'note.md' })
  expect(Buffer.from(note.blob).toString()).toBe('# Windows\nSecond line\n')
})

it('retains an executable mode change when checkpointing another content edit', async () => {
  const context = await packedRepository()
  await chmod(join(context.dir, 'note.md'), 0o755)
  await writeFile(join(context.dir, 'unchanged.md'), '# Edited alongside a mode change\n')
  const result = await createGitVault(context).checkpoint(author)
  const { commit } = await git.readCommit({ ...context, oid: result.oid })
  const { tree } = await git.readTree({ ...context, oid: commit.tree })
  expect(tree.find((entry) => entry.path === 'note.md')?.mode).toBe('100755')
})

it('commits all additions when a change exceeds the small-batch staging limit', async () => {
  const context = await packedRepository()
  for (let index = 0; index < 20; index++) await writeFile(join(context.dir, `${index}.md`), `# Added ${index}\n`)
  expect((await createGitVault(context).checkpoint(author)).changedFiles).toBe(20)
  expect(await git.listFiles(context)).toHaveLength(22)
})

it('falls back to library staging when a tracked file becomes a directory', async () => {
  const context = await packedRepository()
  const path = join(context.dir, 'note.md')
  await rm(path)
  await mkdir(path)
  await writeFile(join(path, 'child.md'), '# Child\n')
  const result = await createGitVault(context).checkpoint(author)
  const child = await git.readBlob({ ...context, oid: result.oid, filepath: 'note.md/child.md' })
  expect(Buffer.from(child.blob).toString()).toBe('# Child\n')
  expect(await git.listFiles(context)).toEqual(['note.md/child.md', 'unchanged.md'])
})

it('falls back to library staging when a tracked directory becomes a file', async () => {
  const context = await packedRepository()
  const folder = join(context.dir, 'folder')
  await mkdir(folder)
  await writeFile(join(folder, 'child.md'), '# Child\n')
  await git.add({ ...context, filepath: '.' })
  await git.commit({ ...context, author, message: 'Directory fixture' })
  await rm(folder, { recursive: true })
  await writeFile(folder, '# File in place of directory\n')
  const result = await createGitVault(context).checkpoint(author)
  const file = await git.readBlob({ ...context, oid: result.oid, filepath: 'folder' })
  expect(Buffer.from(file.blob).toString()).toBe('# File in place of directory\n')
  expect(await git.listFiles(context)).toEqual(['folder', 'note.md', 'unchanged.md'])
})

it('uses library staging for tracked symlinks instead of reading their targets', async () => {
  const context = await packedRepository()
  await rm(join(context.dir, 'note.md'))
  await symlink('unchanged.md', join(context.dir, 'note.md'))
  const result = await createGitVault(context).checkpoint(author)
  const note = await git.readBlob({ ...context, oid: result.oid, filepath: 'note.md' })
  expect(Buffer.from(note.blob).toString()).toBe('unchanged.md')
})

it('fails without advancing HEAD or deleting content when verification cannot read a file', async () => {
  const context = await packedRepository()
  const head = await git.resolveRef({ ...context, ref: 'HEAD' })
  const failingFs = { promises: { ...fs.promises, readFile: async (path: fs.PathLike, options?: Parameters<typeof readFile>[1]) => {
    if (String(path) === join(context.dir, 'note.md')) throw new Error('verificationReadFailed')
    return fs.promises.readFile(path, options)
  } } }
  await expect(createGitVault({ ...context, fs: failingFs }).checkpoint(author)).rejects.toThrow('verificationReadFailed')
  expect(await git.resolveRef({ ...context, ref: 'HEAD' })).toBe(head)
  expect(await readFile(join(context.dir, 'note.md'), 'utf8')).toContain('# Original')
})

it('keeps callback-only filesystem adapters compatible with library staging', async () => {
  const context = await packedRepository()
  await writeFile(join(context.dir, 'note.md'), '# Callback adapter edit\n')
  const callbacks = { ...fs }
  Reflect.deleteProperty(callbacks, 'promises')
  const callbackContext = { dir: context.dir, fs: callbacks }
  await stageVerifiedGitChanges(callbackContext)
  expect(await git.status({ ...callbackContext, filepath: 'note.md' })).toBe('modified')
})
