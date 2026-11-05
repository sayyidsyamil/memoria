import { afterEach, expect, it, vi } from 'vitest'
import { buildLocalVaultWorkspaceSnapshot, type LocalVaultFile } from './localVaultSnapshot'
import { buildCooperativeWorkspaceSnapshot } from './cooperativeWorkspaceSnapshot'

afterEach(() => vi.restoreAllMocks())

function file(relativePath: string, content: string): LocalVaultFile {
  return { relativePath, content, absolutePath: `file:///fixture/${relativePath}`, createdAt: 1, modifiedAt: 2, size: content.length }
}

function options() {
  return {
    files: [
      file('types/Essay.md', '---\ntype: Type\ncolor: green\nplural: Essays\n---\n# Essay\n'),
      file('target.md', '---\ntype: Project\naliases: [Destination]\n---\n# Target\n'),
      file('views/essays.yml', 'name: Essays\nfilters:\n  all:\n    - field: type\n      op: equals\n      value: Essay\n'),
      ...Array.from({ length: 40 }, (_, n) => file(`essay-${n}.md`, `---\ntype: Essay\ncustom: keep\n_favorite: true\nrelated_to: ["[[Destination]]"]\n---\n# Essay ${n}\n\nBody **bold**.\n`)),
      { ...file('image.png', ''), fileKind: 'binary' as const },
    ],
    folderPaths: ['types', 'views', 'empty'], vaultAlias: 'fixture', vaultLabel: 'Fixture', vaultPath: 'file:///fixture',
    vaultConfig: { defaultNoteWidth: 'wide' as const },
  }
}

it('preserves the complete synchronous snapshot including definitions, views, relationships, config and file metadata', async () => {
  const input = options()
  expect(await buildCooperativeWorkspaceSnapshot(input)).toEqual(buildLocalVaultWorkspaceSnapshot(input))
  expect(input.files[3].content).toContain('custom: keep')
})

it('allows a real timer to run before a budget-exceeding snapshot finishes', async () => {
  let time = 0
  vi.spyOn(performance, 'now').mockImplementation(() => { time += 8; return time })
  let finished = false
  const pulse = new Promise<void>(resolve => setTimeout(resolve, 0))
  const pending = buildCooperativeWorkspaceSnapshot(options()).then(value => { finished = true; return value })
  await pulse
  expect(finished).toBe(false)
  expect((await pending).allNotes).toHaveLength(44)
})

it('cancels an obsolete load at a task boundary without publishing a partial snapshot', async () => {
  let time = 0
  vi.spyOn(performance, 'now').mockImplementation(() => { time += 8; return time })
  const controller = new AbortController()
  const pending = buildCooperativeWorkspaceSnapshot(options(), controller.signal)
  controller.abort()
  await expect(pending).rejects.toThrow('workspaceLoadCancelled')
})

it('keeps an empty vault and a zero-note preview identical to the existing builder', async () => {
  for (const input of [{ ...options(), files: [] }, { ...options(), maxNotes: 0 }]) {
    expect(await buildCooperativeWorkspaceSnapshot(input)).toEqual(buildLocalVaultWorkspaceSnapshot(input))
  }
})

it('propagates parsing failures instead of substituting a partial or fixture vault', async () => {
  const input = options()
  Object.defineProperty(input.files[0], 'content', { get: () => { throw new Error('readFailure') } })
  await expect(buildCooperativeWorkspaceSnapshot(input)).rejects.toThrow('readFailure')
})
