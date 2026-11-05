import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import git from 'isomorphic-git'
import { afterEach, expect, it } from 'vitest'
import { syncGitVault } from './gitRemote'
import { fetchTrackedGitBranch } from './fetchTrackedGitBranch'
import { gitTestEnvironment } from './gitTestServer'
import { createGitFetchFixture, requestText } from './gitFetchTestFixture'

const author = { name: 'Test', email: 'qa@example.invalid' }
const cleanup: (() => Promise<void>)[] = []
const processOptions = { env: gitTestEnvironment(), stdio: 'pipe' as const }
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action()
})

async function fixture(branch = 'main') {
  const result = await createGitFetchFixture(branch)
  cleanup.push(result.close)
  return result
}

async function publishBranch(seed: string, remote: string, ref: string) {
  await git.branch({ fs, dir: seed, ref })
  await git.checkout({ fs, dir: seed, ref })
  await writeFile(join(seed, 'remote-only.md'), '# Remote branch\n')
  await git.add({ fs, dir: seed, filepath: '.' })
  const oid = await git.commit({ fs, dir: seed, author, message: 'Remote branch fixture' })
  execFileSync('git', ['-C', seed, 'push', remote, ref], processOptions)
  return oid
}

it('advertises a server-known base after checkpointing a local edit', async () => {
  const { context, meter, base, remote } = await fixture()
  const content = '---\ncustom: preserved\n---\n# Local edit\n'
  await writeFile(join(context.dir, 'note-0.md'), content)
  expect(await syncGitVault(context, author)).toMatchObject({ kind: 'synced', changedFiles: 1 })
  expect(meter.exchanges).toHaveLength(1)
  expect(requestText(meter.exchanges[0])).toContain(`have ${base}\n`)
  const head = await git.resolveRef({ ...context, ref: 'HEAD' })
  expect(requestText(meter.exchanges[0])).not.toContain(`have ${head}\n`)
  expect(await git.resolveRef({ ...context, ref: 'refs/remotes/origin/main' })).toBe(head)
  expect(execFileSync('git', ['--git-dir', remote, 'rev-parse', 'main'], processOptions).toString().trim()).toBe(head)
  expect(await readFile(join(context.dir, 'note-0.md'), 'utf8')).toBe(content)
  expect(await readFile(join(context.dir, 'attachment.bin'))).toEqual(Buffer.from([0, 255, 128, 10]))
  expect(await git.listBranches(context)).toEqual(['main'])
})

it('does not download the whole unchanged vault before pushing one local edit', async () => {
  const { context, meter, cloneBytes } = await fixture()
  await writeFile(join(context.dir, 'note-0.md'), '# Edited\n')
  expect(await syncGitVault(context, author)).toMatchObject({ kind: 'synced', changedFiles: 1 })
  const received = meter.exchanges.reduce((sum, exchange) => sum + exchange.receivedBytes, 0)
  expect(received, `initial clone ${cloneBytes} bytes; pre-push fetch ${received} bytes`).toBeLessThan(cloneBytes / 8)
})

it('negotiates nested branch names without changing the local branch', async () => {
  const { context, meter, base } = await fixture('notes/mobile')
  await writeFile(join(context.dir, 'note-0.md'), '# Edited\n')
  expect(await syncGitVault(context, author)).toMatchObject({ kind: 'synced', changedFiles: 1 })
  expect(requestText(meter.exchanges[0])).toContain(`have ${base}\n`)
  expect(await git.currentBranch(context)).toBe('notes/mobile')
  expect(await git.resolveRef({ ...context, ref: 'refs/remotes/origin/notes/mobile' }))
    .toBe(await git.resolveRef({ ...context, ref: 'HEAD' }))
})

it('uses the newly published tip for the next unchanged sync without creating negotiation branches', async () => {
  const { context, meter, cloneBytes } = await fixture()
  await writeFile(join(context.dir, 'note-0.md'), '# Edited\n')
  await syncGitVault(context, author)
  const head = await git.resolveRef({ ...context, ref: 'HEAD' })
  meter.exchanges.splice(0)
  expect(await syncGitVault(context, author)).toMatchObject({ kind: 'synced', changedFiles: 0 })
  expect(meter.exchanges).toHaveLength(1)
  expect(requestText(meter.exchanges[0])).toContain(`have ${head}\n`)
  expect(meter.exchanges[0].receivedBytes).toBeLessThan(cloneBytes / 8)
  expect(await git.listBranches(context)).toEqual(['main'])
})

it.each(['missing', 'missing-object'])('recovers %s tracking data through normal server negotiation', async kind => {
  const { context, meter, base } = await fixture()
  const tracking = { ...context, ref: 'refs/remotes/origin/main' }
  if (kind === 'missing') await git.deleteRef(tracking)
  else await git.writeRef({ ...tracking, value: 'f'.repeat(40), force: true })
  const content = '---\ncustom: preserved\n---\n# Saved\n'
  await writeFile(join(context.dir, 'note-0.md'), content)
  expect(await syncGitVault(context, author)).toMatchObject({ kind: 'synced', changedFiles: 1 })
  expect(meter.exchanges).toHaveLength(1)
  expect(requestText(meter.exchanges[0])).toContain(`want ${base} `)
  expect(requestText(meter.exchanges[0])).not.toContain(`have ${'f'.repeat(40)}\n`)
  expect(await git.resolveRef(tracking)).toBe(await git.resolveRef({ ...context, ref: 'HEAD' }))
  expect(await readFile(join(context.dir, 'note-0.md'), 'utf8')).toBe(content)
})

it('retains default origin selection when branch configuration is absent', async () => {
  const { context, meter, base } = await fixture()
  for (const key of ['remote', 'merge']) {
    execFileSync('git', ['-C', context.dir, 'config', '--unset', `branch.main.${key}`], processOptions)
  }
  expect((await fetchTrackedGitBranch({ ...context, ref: 'main' })).fetchHead).toBe(base)
  expect(requestText(meter.exchanges[0])).toContain(`have ${base}\n`)
  expect(await git.resolveRef({ ...context, ref: 'HEAD' })).toBe(base)
})

it.each(['configured', 'explicit'])('preserves %s nonstandard upstream selection', async kind => {
  const { context, meter, seed, remote, base } = await fixture()
  const topic = await publishBranch(seed, remote, 'topic')
  if (kind === 'configured') await git.setConfig({ ...context, path: 'branch.main.merge', value: 'refs/heads/topic' })
  const selection = kind === 'explicit' ? { remoteRef: 'refs/heads/topic' } : {}
  const result = await fetchTrackedGitBranch({ ...context, ...selection, ref: 'main' })
  expect(result.fetchHead).toBe(topic)
  expect(requestText(meter.exchanges[0])).toContain(`want ${topic} `)
  expect(await git.resolveRef({ ...context, ref: 'refs/remotes/origin/topic' })).toBe(topic)
  expect(await git.resolveRef({ ...context, ref: 'HEAD' })).toBe(base)
})

it.each(['configured', 'explicit'])('preserves %s non-origin remote selection', async kind => {
  const { context, base } = await fixture()
  await git.addRemote({ ...context, remote: 'secondary', url: 'https://github.com/team/vault.git' })
  if (kind === 'configured') await git.setConfig({ ...context, path: 'branch.main.remote', value: 'secondary' })
  const selection = kind === 'explicit' ? { remote: 'secondary' } : {}
  expect((await fetchTrackedGitBranch({ ...context, ...selection, ref: 'main' })).fetchHead).toBe(base)
  expect(await git.resolveRef({ ...context, ref: 'refs/remotes/secondary/main' })).toBe(base)
  expect(await git.resolveRef({ ...context, ref: 'HEAD' })).toBe(base)
})

it('does not fetch unrelated branches to improve negotiation', async () => {
  const { context, meter, seed, remote, base } = await fixture()
  const topic = await publishBranch(seed, remote, 'unrelated')
  await writeFile(join(context.dir, 'note-0.md'), '# Edited\n')
  expect(await syncGitVault(context, author)).toMatchObject({ kind: 'synced', changedFiles: 1 })
  expect(requestText(meter.exchanges[0])).toContain(`want ${base} `)
  expect(requestText(meter.exchanges[0])).not.toContain(`want ${topic} `)
  expect(await git.listBranches({ ...context, remote: 'origin' })).not.toContain('unrelated')
  await expect(git.readCommit({ ...context, oid: topic })).rejects.toThrow()
})
