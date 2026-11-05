import { lstat, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { git } from '../src/git.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { blobEtag, vaultPath as at } from '../src/paths.ts'
import { type Vault, writeOutcome } from '../src/vault.ts'
import { createFixture, type Fixture, SEED_NOTES, text } from './helpers.ts'

const NOW = new Date('2026-10-10T19:03:00Z')
const CONFLICT_COPY = 'welcome (conflict 2026-10-10 1903).md'
const WELCOME_ETAG = blobEtag(text(SEED_NOTES['welcome.md']))

let fixture: Fixture
let vault: Vault
let logs: string[]
let clockBroken: boolean

function clock(): Date {
  if (clockBroken) throw new Error('clock broke')
  return NOW
}

beforeEach(async () => {
  fixture = await createFixture()
  logs = []
  clockBroken = false
  vault = await fixture.openVault({ now: clock, log: (message) => logs.push(message) })
})

afterEach(async () => {
  await vault.idle()
  await fixture.cleanup()
})

async function paths(): Promise<string[]> {
  return (await vault.list()).files.map((file) => file.path).sort()
}

async function content(path: string): Promise<string> {
  return (await vault.read(at(path))).bytes.toString('utf8')
}

describe('writeOutcome', () => {
  it.each([
    [null, { kind: 'absent' }, 'created'],
    [null, { kind: 'any' }, 'created'],
    [null, { kind: 'match', etag: 'old' }, 'recreated'],
    ['old', { kind: 'match', etag: 'old' }, 'updated'],
    ['old', { kind: 'any' }, 'updated'],
    ['newer', { kind: 'match', etag: 'old' }, 'conflict'],
    ['old', { kind: 'absent' }, 'conflict'],
    ['new', { kind: 'match', etag: 'old' }, 'unchanged'],
  ] as const)('stored %j with %j is %s', (current, precondition, expected) => {
    expect(writeOutcome(current, 'new', precondition)).toBe(expected)
  })
})

describe('reading a vault', () => {
  it('lists every tracked file with its size and git blob etag', async () => {
    const { head, files } = await vault.list()
    expect(head).toMatch(/^[0-9a-f]{40}$/)
    expect(files.map((file) => file.path).sort()).toEqual(Object.keys(SEED_NOTES).sort())
    const welcome = files.find((file) => file.path === 'welcome.md')
    expect(welcome).toEqual({ path: 'welcome.md', size: SEED_NOTES['welcome.md'].length, etag: WELCOME_ETAG })
  })

  it('filters the listing by path prefix', async () => {
    expect((await vault.list('projects/')).files.map((file) => file.path)).toEqual(['projects/alpha.md'])
  })

  it('reads notes and attachments as bytes', async () => {
    const note = await vault.read(at('welcome.md'))
    expect(note.bytes.toString('utf8')).toBe(SEED_NOTES['welcome.md'])
    expect(note.etag).toBe(WELCOME_ETAG)
    expect((await vault.read(at('attachments/pixel.bin'))).bytes.subarray(0, 3)).toEqual(Buffer.from([0, 1, 2]))
  })

  it('answers not_found for a missing file and for a directory', async () => {
    await expect(vault.read(at('missing.md'))).rejects.toMatchObject({ status: 404, code: 'not_found' })
    await expect(vault.read(at('projects'))).rejects.toMatchObject({ status: 404, code: 'not_found' })
  })

  it('names the vault after its remote', async () => {
    expect(await vault.info()).toEqual({ name: 'remote', branch: 'main', head: (await vault.list()).head })
  })
})

describe('writing', () => {
  it('makes one commit per save and pushes it to the remote', async () => {
    const before = await fixture.desktop.log()
    const result = await vault.write(at('welcome.md'), text('# Welcome\n\nEdited on the web.\n'), {
      kind: 'match',
      etag: WELCOME_ETAG,
    })

    expect(result).toMatchObject({ outcome: 'updated', path: 'welcome.md', pushed: true })
    expect(result.etag).toBe(blobEtag(text('# Welcome\n\nEdited on the web.\n')))
    expect(result.timings.pullMs).toBeGreaterThan(0)
    const after = await fixture.desktop.log()
    expect(after).toEqual(['Update welcome.md', ...before])
    expect(await fixture.desktop.read('welcome.md')).toBe('# Welcome\n\nEdited on the web.\n')
    expect((await vault.list()).head).toBe(result.commit)
  })

  it('creates a new file, including missing folders', async () => {
    const result = await vault.write(at('inbox/2026/idea.md'), text('# Idea\n'), { kind: 'absent' })
    expect(result).toMatchObject({ outcome: 'created', path: 'inbox/2026/idea.md', pushed: true })
    expect(await fixture.desktop.read('inbox/2026/idea.md')).toBe('# Idea\n')
  })

  it('does not commit when the content is already stored', async () => {
    const before = await fixture.desktop.log()
    const result = await vault.write(at('welcome.md'), text(SEED_NOTES['welcome.md']), { kind: 'match', etag: 'stale' })
    expect(result).toMatchObject({ outcome: 'unchanged', path: 'welcome.md', etag: WELCOME_ETAG })
    expect(await fixture.desktop.log()).toEqual(before)
  })

  it('overwrites without a base revision only when asked to', async () => {
    const result = await vault.write(at('welcome.md'), text('last write wins\n'), { kind: 'any' })
    expect(result.outcome).toBe('updated')
    expect(await content('welcome.md')).toBe('last write wins\n')
  })

  it('stores binary attachments byte for byte', async () => {
    const bytes = new Uint8Array([0, 255, 10, 13, 0, 128])
    await vault.write(at('attachments/raw.bin'), bytes, { kind: 'absent' })
    expect(new Uint8Array((await vault.read(at('attachments/raw.bin'))).bytes)).toEqual(bytes)
  })

  it('pulls before writing, so a desktop edit to another file is kept', async () => {
    await fixture.desktop.commit('projects/alpha.md', '# Alpha\n\nEdited on the desktop.\n')
    const result = await vault.write(at('welcome.md'), text('web edit\n'), { kind: 'match', etag: WELCOME_ETAG })

    expect(result.outcome).toBe('updated')
    expect(await content('projects/alpha.md')).toBe('# Alpha\n\nEdited on the desktop.\n')
    expect((await fixture.desktop.log()).slice(0, 2)).toEqual(['Update welcome.md', 'desktop: projects/alpha.md'])
  })

  it('recreates a file the desktop deleted when the web edit was based on it', async () => {
    await fixture.desktop.commit('welcome.md', null)
    const result = await vault.write(at('welcome.md'), text('still wanted\n'), { kind: 'match', etag: WELCOME_ETAG })
    expect(result.outcome).toBe('recreated')
    expect(await fixture.desktop.read('welcome.md')).toBe('still wanted\n')
  })
})

describe('conflict copies', () => {
  it('keeps the upstream version and saves a stale edit as a conflict copy', async () => {
    await fixture.desktop.commit('welcome.md', 'desktop version\n')
    const result = await vault.write(at('welcome.md'), text('web version\n'), { kind: 'match', etag: WELCOME_ETAG })

    expect(result).toMatchObject({
      outcome: 'conflict',
      path: CONFLICT_COPY,
      etag: blobEtag(text('web version\n')),
      pushed: true,
      current: { path: 'welcome.md', etag: blobEtag(text('desktop version\n')) },
    })
    expect(await fixture.desktop.read('welcome.md')).toBe('desktop version\n')
    expect(await fixture.desktop.read(CONFLICT_COPY)).toBe('web version\n')
    expect((await fixture.desktop.log())[0]).toBe('Conflict copy of welcome.md')
  })

  it('numbers a second conflict copy made in the same minute', async () => {
    await fixture.desktop.commit('welcome.md', 'desktop version\n')
    await vault.write(at('welcome.md'), text('web one\n'), { kind: 'match', etag: WELCOME_ETAG })
    const second = await vault.write(at('welcome.md'), text('web two\n'), { kind: 'match', etag: WELCOME_ETAG })
    expect(second.path).toBe('welcome (conflict 2026-10-10 1903 2).md')
  })

  it('makes a conflict copy when a "create" finds the file already there', async () => {
    const result = await vault.write(at('welcome.md'), text('a different welcome\n'), { kind: 'absent' })
    expect(result).toMatchObject({ outcome: 'conflict', path: CONFLICT_COPY })
    expect(await content('welcome.md')).toBe(SEED_NOTES['welcome.md'])
  })
})

describe('a desktop push that lands in the middle of a save', () => {
  it('keeps the desktop version and returns the web edit as a conflict copy', async () => {
    let raced = false
    vault.onChange(async () => {
      if (raced) return
      raced = true
      await fixture.desktop.commit('welcome.md', 'desktop won the race\n')
    })
    const result = await vault.write(at('welcome.md'), text('web lost the race\n'), { kind: 'match', etag: WELCOME_ETAG })

    expect(result).toMatchObject({
      outcome: 'conflict',
      path: CONFLICT_COPY,
      pushed: true,
      current: { path: 'welcome.md', etag: blobEtag(text('desktop won the race\n')) },
    })
    expect(logs.some((line) => line.startsWith('push failed (attempt 1)'))).toBe(true)
    expect(await fixture.desktop.read('welcome.md')).toBe('desktop won the race\n')
    expect(await fixture.desktop.read(CONFLICT_COPY)).toBe('web lost the race\n')
  })
})

describe('writes the vault cannot place', () => {
  it('refuses to replace a folder with a file', async () => {
    await expect(vault.write(at('projects'), text('x'), { kind: 'any' })).rejects.toMatchObject({
      status: 409,
      code: 'destination_exists',
    })
  })

  it('refuses a path that runs through a file, for writes and renames', async () => {
    const refusal = { status: 409, code: 'destination_exists' }
    await expect(vault.write(at('welcome.md/child.md'), text('x'), { kind: 'absent' })).rejects.toMatchObject(refusal)
    await expect(vault.rename(at('projects/alpha.md'), at('welcome.md/alpha.md'))).rejects.toMatchObject(refusal)
    expect(await paths()).toEqual(Object.keys(SEED_NOTES).sort())
  })

  it('keeps working after an unexpected failure, and still delivers what was committed', async () => {
    let broken = true
    vault.onChange(async () => {
      if (broken) throw new Error('listener broke')
    })
    await expect(vault.write(at('inbox/a.md'), text('a\n'), { kind: 'absent' })).rejects.toThrowError('listener broke')

    broken = false
    const next = await vault.write(at('welcome.md'), text('still works\n'), { kind: 'match', etag: WELCOME_ETAG })
    expect(next).toMatchObject({ outcome: 'updated', pushed: true })
    expect(await fixture.desktop.read('inbox/a.md')).toBe('a\n')
  })
})

describe('when the git remote is unreachable', () => {
  const parked = (): string => `${fixture.remote}.offline`

  it('commits locally, reports pushed: false, and delivers the commit on the next sync', async () => {
    await rename(fixture.remote, parked())
    const result = await vault.write(at('welcome.md'), text('offline edit\n'), { kind: 'match', etag: WELCOME_ETAG })
    expect(result).toMatchObject({ outcome: 'updated', pushed: false })
    expect(logs.some((line) => line.startsWith('fetch failed'))).toBe(true)
    expect(await vault.syncNow()).toMatchObject({ pulled: false, pushed: false })

    await rename(parked(), fixture.remote)
    expect(await vault.syncNow()).toMatchObject({ pulled: true, pushed: true })
    expect(await fixture.desktop.read('welcome.md')).toBe('offline edit\n')
  })

  it('replays unpushed edits onto upstream, turning a contested file into a conflict copy', async () => {
    await rename(fixture.remote, parked())
    await vault.write(at('welcome.md'), text('offline web edit\n'), { kind: 'match', etag: WELCOME_ETAG })
    await vault.write(at('inbox/offline.md'), text('# Written offline\n'), { kind: 'absent' })
    await vault.remove(at('attachments/pixel.bin'), blobEtag(text(SEED_NOTES['attachments/pixel.bin'])))
    await rename(parked(), fixture.remote)
    await fixture.desktop.commit('welcome.md', 'desktop version\n')

    expect(await vault.syncNow()).toMatchObject({ pulled: true, pushed: true })

    expect(await fixture.desktop.read('welcome.md')).toBe('desktop version\n')
    expect(await fixture.desktop.read(CONFLICT_COPY)).toBe('offline web edit\n')
    expect(await fixture.desktop.read('inbox/offline.md')).toBe('# Written offline\n')
    expect(await paths()).not.toContain('attachments/pixel.bin')
    expect((await fixture.desktop.log())[0]).toBe('Replay 3 local change(s) onto upstream')
  })

  it('moves an offline note aside when upstream turned its folder into a file', async () => {
    await rename(fixture.remote, parked())
    await vault.write(at('inbox/offline.md'), text('# Written offline\n'), { kind: 'absent' })
    await rename(parked(), fixture.remote)
    await fixture.desktop.commit('inbox', 'inbox is a file now\n')

    expect(await vault.syncNow()).toMatchObject({ pulled: true, pushed: true })
    expect(await fixture.desktop.read('inbox')).toBe('inbox is a file now\n')
    expect(await fixture.desktop.read('inbox (conflict 2026-10-10 1903)/offline.md')).toBe('# Written offline\n')
  })

  it('moves an offline file aside when upstream made a folder at its path', async () => {
    await rename(fixture.remote, parked())
    await vault.write(at('drafts'), text('a file called drafts\n'), { kind: 'absent' })
    await rename(parked(), fixture.remote)
    await fixture.desktop.commit('drafts/plan.md', '# Plan\n')

    expect(await vault.syncNow()).toMatchObject({ pulled: true, pushed: true })
    expect(await fixture.desktop.read('drafts/plan.md')).toBe('# Plan\n')
    expect(await fixture.desktop.read('drafts (conflict 2026-10-10 1903)')).toBe('a file called drafts\n')
  })

  it('keeps unpushed commits when a replay fails, and replays them on the next sync', async () => {
    await rename(fixture.remote, parked())
    await vault.write(at('welcome.md'), text('offline web edit\n'), { kind: 'match', etag: WELCOME_ETAG })
    await rename(parked(), fixture.remote)
    await fixture.desktop.commit('welcome.md', 'desktop version\n')

    clockBroken = true
    await expect(vault.syncNow()).rejects.toThrowError('clock broke')
    expect(await content('welcome.md')).toBe('offline web edit\n')

    clockBroken = false
    expect(await vault.syncNow()).toMatchObject({ pulled: true, pushed: true })
    expect(await fixture.desktop.read('welcome.md')).toBe('desktop version\n')
    expect(await fixture.desktop.read(CONFLICT_COPY)).toBe('offline web edit\n')
  })

  it('keeps an upstream edit to a file that was deleted offline', async () => {
    await rename(fixture.remote, parked())
    await vault.remove(at('welcome.md'), WELCOME_ETAG)
    await rename(parked(), fixture.remote)
    await fixture.desktop.commit('welcome.md', 'desktop still edits this\n')

    await vault.syncNow()
    expect(await content('welcome.md')).toBe('desktop still edits this\n')
  })
})

describe('symbolic links in the vault', () => {
  async function plantSecretAndLink(): Promise<string> {
    const secret = join(fixture.root, 'secret.txt')
    await writeFile(secret, 'outside the vault\n')
    await fixture.desktop.commitSymlink({ path: 'leak.md', target: secret })
    return secret
  }

  it('checks a pushed symlink out as a plain file and never follows it', async () => {
    const secret = await plantSecretAndLink()
    await vault.syncNow()

    expect((await lstat(join(fixture.vaultDir, 'leak.md'))).isSymbolicLink()).toBe(false)
    expect(await content('leak.md')).toBe(secret)
    expect(await paths()).not.toContain('leak.md')
  })

  it('does so even when the clone was configured to create symlinks', async () => {
    await git(fixture.vaultDir, ['config', 'core.symlinks', 'true'])
    const secret = await plantSecretAndLink()
    await vault.syncNow()
    const reopened = await fixture.openVault()

    expect((await lstat(join(fixture.vaultDir, 'leak.md'))).isSymbolicLink()).toBe(false)
    expect((await reopened.read(at('leak.md'))).bytes.toString('utf8')).toBe(secret)
  })
})

describe('rename', () => {
  it('reports where the file ended up when the desktop takes the destination mid-rename', async () => {
    let raced = false
    vault.onChange(async () => {
      if (raced) return
      raced = true
      await fixture.desktop.commit('archive/hello.md', 'desktop got here first\n')
    })
    const result = await vault.rename(at('welcome.md'), at('archive/hello.md'), { ifMatch: WELCOME_ETAG })

    expect(result).toMatchObject({ from: 'welcome.md', path: 'archive/hello (conflict 2026-10-10 1903).md', pushed: true })
    expect(await fixture.desktop.read('archive/hello.md')).toBe('desktop got here first\n')
    expect(await fixture.desktop.read(result.path)).toBe(SEED_NOTES['welcome.md'])
    expect(await paths()).not.toContain('welcome.md')
  })

  it('moves the file in one pushed commit and keeps its etag', async () => {
    const result = await vault.rename(at('welcome.md'), at('archive/hello.md'), { ifMatch: WELCOME_ETAG })
    expect(result).toMatchObject({ from: 'welcome.md', path: 'archive/hello.md', etag: WELCOME_ETAG, pushed: true })
    expect(await paths()).toEqual(['archive/hello.md', 'attachments/pixel.bin', 'projects/alpha.md'])
    expect((await fixture.desktop.log())[0]).toBe('Rename welcome.md to archive/hello.md')
  })

  it('refuses a missing source, a taken destination and a stale revision', async () => {
    await expect(vault.rename(at('missing.md'), at('x.md'))).rejects.toMatchObject({ status: 404 })
    await expect(vault.rename(at('welcome.md'), at('projects/alpha.md'))).rejects.toMatchObject({
      status: 409,
      code: 'destination_exists',
    })
    await expect(vault.rename(at('welcome.md'), at('x.md'), { ifMatch: 'stale' })).rejects.toMatchObject({
      status: 412,
      code: 'precondition_failed',
      details: { current: { path: 'welcome.md', etag: WELCOME_ETAG } },
    })
    expect(await paths()).toEqual(Object.keys(SEED_NOTES).sort())
  })
})

describe('delete', () => {
  it('removes the file in one pushed commit', async () => {
    const result = await vault.remove(at('welcome.md'), WELCOME_ETAG)
    expect(result).toMatchObject({ path: 'welcome.md', pushed: true })
    expect(await paths()).not.toContain('welcome.md')
    expect((await fixture.desktop.log())[0]).toBe('Delete welcome.md')
  })

  it('refuses when the file changed since the client saw it', async () => {
    await fixture.desktop.commit('welcome.md', 'desktop version\n')
    await expect(vault.remove(at('welcome.md'), WELCOME_ETAG)).rejects.toMatchObject({ status: 412 })
    await expect(vault.remove(at('missing.md'), WELCOME_ETAG)).rejects.toMatchObject({ status: 404 })
    expect(await content('welcome.md')).toBe('desktop version\n')
  })
})

describe('search', () => {
  it('finds text case-insensitively with line numbers, and skips binary files', async () => {
    const { results, truncated } = await vault.search('heron', 10)
    expect(truncated).toBe(false)
    expect(results).toEqual([
      {
        path: 'projects/alpha.md',
        pathMatch: false,
        matches: [{ line: 3, text: 'Links to [[welcome]] and mentions the Heron.' }],
      },
    ])
    expect((await vault.search('binary', 10)).results).toEqual([])
  })

  it('matches file names and treats the query as literal text', async () => {
    const byName = await vault.search('ALPHA', 10)
    expect(byName.results[0]).toMatchObject({ path: 'projects/alpha.md', pathMatch: true })
    expect((await vault.search('[[welcome]]', 10)).results.map((result) => result.path)).toEqual(['projects/alpha.md'])
    expect((await vault.search('.*', 10)).results).toEqual([])
  })

  it('reports truncation when there are more results than the limit', async () => {
    const { results, truncated } = await vault.search('e', 1)
    expect(results).toHaveLength(1)
    expect(truncated).toBe(true)
  })
})

describe('sync', () => {
  it('picks up desktop pushes and reports them to listeners', async () => {
    const seen: unknown[] = []
    vault.onChange(async (changes) => {
      seen.push(...changes)
    })
    await fixture.desktop.commit('projects/beta.md', '# Beta\n')
    await fixture.desktop.rename('welcome.md', 'hello.md')
    await fixture.desktop.commit('projects/alpha.md', null)

    const result = await vault.syncNow()
    expect(result).toMatchObject({ pulled: true, pushed: true, head: (await vault.list()).head })
    expect(await paths()).toEqual(['attachments/pixel.bin', 'hello.md', 'projects/beta.md'])
    expect(seen).toEqual(
      expect.arrayContaining([
        { kind: 'upsert', path: 'projects/beta.md' },
        { kind: 'rename', from: 'welcome.md', to: 'hello.md' },
        { kind: 'delete', path: 'projects/alpha.md' },
      ]),
    )
  })

  it('reopens an existing clone and discards leftovers of an interrupted write', async () => {
    await vault.write(at('welcome.md'), text('saved\n'), { kind: 'any' })
    const reopened = await fixture.openVault()
    expect((await reopened.read(at('welcome.md'))).bytes.toString('utf8')).toBe('saved\n')
  })

  it('serialises concurrent writes to the same file: the second one becomes a conflict copy', async () => {
    const [first, second] = await Promise.all([
      vault.write(at('welcome.md'), text('first\n'), { kind: 'match', etag: WELCOME_ETAG }),
      vault.write(at('welcome.md'), text('second\n'), { kind: 'match', etag: WELCOME_ETAG }),
    ])
    expect(first.outcome).toBe('updated')
    expect(second).toMatchObject({ outcome: 'conflict', path: CONFLICT_COPY })
    expect(await content('welcome.md')).toBe('first\n')
  })
})

describe('updating a file from its stored content', () => {
  it('hands the producer the stored version, after pulling, and commits what it returns', async () => {
    await fixture.desktop.commit('welcome.md', '# From the desktop\n')

    const result = await vault.update(at('welcome.md'), async (current) => text(`${current?.bytes.toString('utf8')}appended\n`))

    expect(result).toMatchObject({ outcome: 'updated', pushed: true })
    expect(await fixture.desktop.read('welcome.md')).toBe('# From the desktop\nappended\n')
  })

  it('makes no commit when the producer returns null', async () => {
    expect(await vault.update(at('welcome.md'), async () => null)).toBeNull()
    expect(await fixture.desktop.log()).toEqual(['Seed vault'])
  })

  it('creates the file when there is none', async () => {
    const result = await vault.update(at('new.md'), async (current) => text(current ? 'unexpected' : '# New\n'))

    expect(result?.outcome).toBe('created')
    expect(await content('new.md')).toBe('# New\n')
  })
})
