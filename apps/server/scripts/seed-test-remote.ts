// Creates a throwaway bare git repository seeded with a fake vault: the stand-in for a
// vault's GitHub remote while developing against the server. Never point it at a real vault.
//
//   node --experimental-strip-types scripts/seed-test-remote.ts <target.git> [filler-notes]
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { git } from '../src/git.ts'

const AUTHOR = {
  GIT_AUTHOR_NAME: 'Memoria Seed',
  GIT_AUTHOR_EMAIL: 'seed@memoria.invalid',
  GIT_COMMITTER_NAME: 'Memoria Seed',
  GIT_COMMITTER_EMAIL: 'seed@memoria.invalid',
}
const DEFAULT_FILLER_NOTES = 200
// Smallest valid PNG: one transparent pixel.
const PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const NOTES: [path: string, content: string][] = [
  ['welcome.md', '---\ntype: Note\n---\n# Welcome\n\nA throwaway vault. See [[projects/heron]] and [[people/ada]].\n'],
  ['projects/heron.md', '---\ntype: Project\nstatus: Active\n---\n# Heron\n\nOwned by [[people/ada]]. ![pixel](../attachments/pixel.png)\n'],
  ['people/ada.md', '---\ntype: Person\n---\n# Ada\n\nWorks on [[projects/heron]].\n'],
  ['journal/2026-10-10.md', '---\ntype: Journal\n---\n# 10 October 2026\n\n- Sketched the sync protocol.\n'],
]

function fillerNote(index: number): [path: string, content: string] {
  const body = `Filler note ${index} so listing and search run over a vault of realistic size.\n`
  return [`filler/note-${String(index).padStart(4, '0')}.md`, `---\ntype: Note\n---\n# Filler ${index}\n\n${body.repeat(20)}`]
}

async function writeVault(dir: string, fillerNotes: number): Promise<void> {
  const filler = Array.from({ length: fillerNotes }, (_, index) => fillerNote(index + 1))
  for (const [path, content] of [...NOTES, ...filler]) {
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await writeFile(join(dir, path), content)
  }
  await mkdir(join(dir, 'attachments'), { recursive: true })
  await writeFile(join(dir, 'attachments', 'pixel.png'), Buffer.from(PIXEL_PNG, 'base64'))
}

function fillerCount(raw: string | undefined): number {
  const count = raw === undefined ? DEFAULT_FILLER_NOTES : Number(raw)
  if (Number.isInteger(count) && count >= 0) return count
  throw new Error('filler-notes must be a non-negative integer')
}

async function seed(target: string, fillerNotes: number): Promise<void> {
  if (existsSync(target)) throw new Error(`${target} already exists; remove it yourself if it is disposable`)
  const work = await mkdtemp(join(tmpdir(), 'memoria-seed-'))
  try {
    await git(work, ['init', '-q', '-b', 'main'])
    await writeVault(work, fillerNotes)
    await git(work, ['add', '-A'])
    await git(work, ['commit', '-q', '-m', 'Seed throwaway test vault'], { env: AUTHOR })
    await mkdir(dirname(target), { recursive: true })
    await git(work, ['clone', '-q', '--bare', work, target])
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const [target, filler] = process.argv.slice(2)
  if (!target) throw new Error('usage: seed-test-remote.ts <target.git> [filler-notes]')
  const count = fillerCount(filler)
  await seed(resolve(target), count)
  process.stdout.write(`seeded ${resolve(target)} with ${NOTES.length + count} notes and 1 attachment\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
