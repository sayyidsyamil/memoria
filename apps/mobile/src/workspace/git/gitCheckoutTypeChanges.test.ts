import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import git from 'isomorphic-git'
import { afterEach, expect, it } from 'vitest'
import { prepareGitTypeChanges } from './gitCheckoutTypeChanges'
import { createGitVault } from './gitVault'
import { gitTestEnvironment } from './gitTestServer'

const roots: string[] = []
const author = { name: 'Test', email: 'qa@example.invalid' }
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture(count = 1) {
  const dir = await mkdtemp(join(tmpdir(), 'memoria-type-walk-'))
  roots.push(dir)
  const context = { fs, dir }
  await git.init({ ...context, defaultBranch: 'main' })
  await mkdir(join(dir, 'library/section/deep'), { recursive: true })
  await writeFile(join(dir, 'library/section/deep/unchanged.md'), '# Untouched\n')
  for (let index = 0; index < count; index++) {
    await mkdir(join(dir, `group-${index}`))
    await writeFile(join(dir, `group-${index}/note.md`), `# Before ${index}\n`)
  }
  await git.add({ ...context, filepath: '.' })
  const before = await git.commit({ ...context, author, message: 'Before' })
  for (let index = 0; index < count; index++) {
    await writeFile(join(dir, `group-${index}/note.md`), `# After ${index}\n`)
  }
  await git.add({ ...context, filepath: '.' })
  const target = await git.commit({ ...context, author, message: 'Target' })
  const library = (await git.readTree({ ...context, oid: before, filepath: 'library' })).tree
  const section = library.find(entry => entry.path === 'section')
  if (!section) throw new Error('Fixture section missing')
  return { context, before, target, sectionObject: join(dir, '.git/objects', section.oid.slice(0, 2), section.oid.slice(2)) }
}

function measuredObjects() {
  const reads: string[] = []
  let active = 0, peak = 0
  const promises = { ...fs.promises, readFile: async (...args: Parameters<typeof fs.promises.readFile>) => {
    const path = String(args[0])
    if (!path.includes('/.git/objects/')) return fs.promises.readFile(...args)
    reads.push(path)
    active++
    peak = Math.max(peak, active)
    try {
      await new Promise<void>(resolve => setImmediate(resolve))
      return await fs.promises.readFile(...args)
    } finally { active-- }
  } }
  return { fs: { promises }, reads, peak: () => peak }
}

async function swapFixture(kind: string) {
  const { context, target: before } = await fixture()
  const directory = kind === 'directory-to-file'
  const path = join(context.dir, directory ? 'group-0' : 'group-0/note.md')
  const output = directory ? path : join(path, 'child.md')
  const content = '---\ncustom: preserved\n---\n# Incoming\n'
  await rm(path, { recursive: true })
  if (!directory) await mkdir(path)
  await writeFile(output, content)
  const target = (await createGitVault(context).checkpoint(author)).oid
  execFileSync('git', ['-C', context.dir, 'checkout', '-b', 'before-checkout', before], {
    env: gitTestEnvironment(), stdio: 'pipe',
  })
  return { context, before, target, path, output, content }
}

it('does not read deeper objects in an identical immutable subtree', async () => {
  const { context, before, target, sectionObject } = await fixture()
  const measured = measuredObjects()
  await prepareGitTypeChanges({ ...context, fs: measured.fs, cache: {} }, before, target)
  expect(measured.reads).not.toContain(sectionObject)
  expect(await readFile(join(context.dir, 'library/section/deep/unchanged.md'), 'utf8')).toBe('# Untouched\n')
  expect(await git.resolveRef({ ...context, ref: 'HEAD' })).toBe(target)
})

it('bounds outstanding object reads to one before/target tree pair', async () => {
  const { context, before, target } = await fixture(24)
  const measured = measuredObjects()
  await prepareGitTypeChanges({ ...context, fs: measured.fs, cache: {} }, before, target)
  expect(measured.reads.length).toBeGreaterThan(24)
  expect(measured.peak()).toBeLessThanOrEqual(2)
  expect(await readFile(join(context.dir, 'group-23/note.md'), 'utf8')).toBe('# After 23\n')
})

it('does not descend an identical root when replaying a completed checkout', async () => {
  const { context, target, sectionObject } = await fixture()
  const measured = measuredObjects()
  await prepareGitTypeChanges({ ...context, fs: measured.fs, cache: {} }, target, target)
  expect(measured.reads).not.toContain(sectionObject)
  expect(await git.status({ ...context, filepath: 'group-0/note.md' })).toBe('unmodified')
})

it('preserves unexpected children when a directory would be replaced by a file', async () => {
  const { context, before, target, path } = await swapFixture('directory-to-file')
  await writeFile(join(path, 'untracked.md'), '# Must survive\n')
  await expect(prepareGitTypeChanges(context, before, target)).rejects.toThrow('checkoutRecoveryChangedFile')
  expect(await readFile(join(path, 'note.md'), 'utf8')).toBe('# After 0\n')
  expect(await readFile(join(path, 'untracked.md'), 'utf8')).toBe('# Must survive\n')
  expect(await git.resolveRef({ ...context, ref: 'HEAD' })).toBe(before)
})

it('preserves changed bytes when a file would be replaced by a directory', async () => {
  const { context, before, target, path } = await swapFixture('file-to-directory')
  await writeFile(path, '# Must survive\n')
  await expect(prepareGitTypeChanges(context, before, target)).rejects.toThrow('checkoutRecoveryChangedFile')
  expect(await readFile(path, 'utf8')).toBe('# Must survive\n')
  expect(await git.resolveRef({ ...context, ref: 'HEAD' })).toBe(before)
})

it.each(['directory-to-file', 'file-to-directory'])('completes a clean %s checkout', async kind => {
  const { context, target, output, content } = await swapFixture(kind)
  expect(await createGitVault(context).integrate(target)).toBe('updated')
  expect(await readFile(output, 'utf8')).toBe(content)
  expect(await git.resolveRef({ ...context, ref: 'HEAD' })).toBe(target)
  expect((await git.statusMatrix(context)).every(([, head, workdir, stage]) => head === workdir && head === stage)).toBe(true)
})

it.each(['directory-to-file', 'file-to-directory'])('recovers an interrupted %s checkout', async kind => {
  const { context, before, target, output, content } = await swapFixture(kind)
  const interrupted = { ...context, fs: { promises: { ...fs.promises, writeFile: async (...args: Parameters<typeof fs.promises.writeFile>) => {
    if (String(args[0]) === output) throw new Error('simulatedWriteFailure')
    return fs.promises.writeFile(...args)
  } } } }
  await expect(createGitVault(interrupted).integrate(target)).rejects.toMatchObject({
    code: 'MultipleGitError', errors: expect.arrayContaining([expect.objectContaining({ message: 'simulatedWriteFailure' })]),
  })
  expect(await git.resolveRef({ ...context, ref: 'HEAD' })).toBe(before)
  await createGitVault(context).recover()
  expect(await readFile(output, 'utf8')).toBe(content)
  expect(await git.resolveRef({ ...context, ref: 'HEAD' })).toBe(target)
  expect((await git.statusMatrix(context)).every(([, head, workdir, stage]) => head === workdir && head === stage)).toBe(true)
})
