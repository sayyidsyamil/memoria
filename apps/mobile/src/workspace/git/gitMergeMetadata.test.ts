import fs from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import git from 'isomorphic-git'
import { afterEach, expect, it } from 'vitest'
import { createGitVault } from './gitVault'

const author = { name: 'Metadata QA', email: 'qa@example.invalid' }
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function divergent(path: string, base: string, local: string, remote: string) {
  const dir = await mkdtemp(join(tmpdir(), 'memoria-metadata-'))
  roots.push(dir)
  const context = { fs, dir }
  const vault = createGitVault(context)
  const file = join(dir, path)
  await mkdir(dirname(file), { recursive: true })
  await git.init({ ...context, defaultBranch: 'main' })
  await writeFile(file, base)
  await vault.checkpoint(author)
  await git.branch({ ...context, ref: 'remote' })
  await writeFile(file, local)
  const checkpoint = await vault.checkpoint(author)
  await git.checkout({ ...context, ref: 'remote' })
  await writeFile(file, remote)
  const incoming = await vault.checkpoint(author)
  await git.checkout({ ...context, ref: 'main' })
  return { context, vault, file, local: checkpoint.oid, remote: incoming.oid }
}

const yaml = 'left: 1\nseparator: preserved\nright: 2\n'
it('rejects a text-clean merge that combines valid frontmatter into duplicate keys', async () => {
  const base = `---\n${yaml}---\nBody\n`
  const ours = base.replace('left:', 'shared:')
  const state = await divergent('note.md', base, ours, base.replace('right:', 'shared:'))
  const index = await readFile(join(state.context.dir, '.git/index'))
  expect(await state.vault.integrate(state.remote, author)).toBe('diverged')
  expect(await git.resolveRef({ ...state.context, ref: 'HEAD' })).toBe(state.local)
  expect(await readFile(state.file, 'utf8')).toBe(ours)
  expect(await readFile(join(state.context.dir, '.git/index'))).toEqual(index)
})

it('rejects saved-view merges that synthesize duplicate fields from valid inputs', async () => {
  const base = 'name: Test\nleft: 1\n# separator\nfilters:\n  all: []\n# more space\nright: 2\n'
  const ours = base.replace('left:', 'order:')
  const remote = base.replace('right:', 'order:')
  const state = await divergent('views/test.yaml', base, ours, remote)
  expect(await state.vault.integrate(state.remote, author)).toBe('diverged')
  expect(await readFile(state.file, 'utf8')).toBe(ours)
})

it('accepts ordinary body changes and arbitrary valid custom metadata without rewriting bytes', async () => {
  const base = '---\ncustom: { nested: [1, true] }\n---\nFirst\n\nMiddle\n\nLast\n'
  const ours = base.replace('First', 'Local')
  const state = await divergent('note.md', base, ours, base.replace('Last', 'Remote'))
  expect(await state.vault.integrate(state.remote, author)).toBe('merged')
  expect(await readFile(state.file, 'utf8')).toBe(ours.replace('Last', 'Remote'))
})
