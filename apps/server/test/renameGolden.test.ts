import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { VaultPath } from '../src/paths.ts'
import type { Vault } from '../src/vault.ts'
import golden from './fixtures/rename-golden.json'
import { createFixture, type Fixture } from './helpers.ts'

/** Golden parity with the desktop's rename.rs: every case is one of its tests, run on the server. */

interface GoldenCase {
  name: string
  desktopTest: string
  notes: Record<string, string>
  rename: { from: string; to: string; title?: string; oldTitle?: string }
  expected: Record<string, string | null>
  rewritten: string[]
}

const CASES = (golden as unknown as { cases: GoldenCase[] }).cases
let fixture: Fixture

afterEach(async () => {
  await fixture?.cleanup()
})

/** Commits the case's notes from the desktop clone in one commit, then opens the server's vault. */
async function vaultWith(notes: Record<string, string>): Promise<Vault> {
  fixture = await createFixture()
  for (const [path, content] of Object.entries(notes)) {
    await mkdir(dirname(join(fixture.desktop.dir, path)), { recursive: true })
    await writeFile(join(fixture.desktop.dir, path), content)
  }
  await fixture.desktop.run(['add', '-A'])
  await fixture.desktop.run(['commit', '-q', '-m', 'desktop: notes'])
  await fixture.desktop.run(['push', '-q', 'hub', 'HEAD:refs/heads/main'])
  return fixture.openVault()
}

async function serverFile(path: string): Promise<string | null> {
  return readFile(join(fixture.vaultDir, path), 'utf8').catch(() => null)
}

describe('rename with link rewrite matches the desktop (rename.rs golden cases)', () => {
  it.each(CASES.map((golden) => [golden.name, golden] as const))('%s', async (_name, golden) => {
    const vault = await vaultWith(golden.notes)
    const { from, to, ...options } = golden.rename
    const result = await vault.rename(from as VaultPath, to as VaultPath, { ...options, rewriteLinks: true })

    expect(result).toMatchObject({ from, path: to, pushed: true })
    expect([...(result.rewritten ?? [])].sort()).toEqual([...golden.rewritten].sort())
    for (const [path, content] of Object.entries(golden.expected)) {
      expect(await serverFile(path), `${golden.desktopTest}: ${path}`).toBe(content)
    }
    // One rename, one commit on top of the desktop's, and the remote has it.
    const log = await fixture.desktop.log()
    expect(log.slice(0, 2)).toEqual([from === to ? `Retitle ${from}` : `Rename ${from} to ${to}`, 'desktop: notes'])
  })
})
