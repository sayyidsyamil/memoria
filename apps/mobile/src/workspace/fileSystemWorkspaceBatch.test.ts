import { expect, it, vi } from 'vitest'
import { createFileSystemWorkspaceRepository, type WorkspaceFileSystem } from './fileSystemWorkspaceRepository'
import type { MobileWorkspaceWrite } from './mobileWorkspaceEditing'

function fixture(name: string) {
  const fileSystem: WorkspaceFileSystem = {
    createDirectory: vi.fn(), deleteDirectory: vi.fn(), deleteTextFile: vi.fn(),
    moveDirectory: vi.fn(), moveTextFile: vi.fn(), readVaultDirectories: () => [],
    readTextFile: () => null, readVaultFiles: () => [], writeTextFile: vi.fn(),
    writeTextBatch: vi.fn(async () => {}),
  }
  return { fileSystem, repository: createFileSystemWorkspaceRepository(fileSystem),
    request: { source: 'native' as const, vaultRootUri: `file:///batch-${name}` } }
}

const first = { kind: 'saveNote' as const, path: 'first.md', content: '---\ncustom: retained\n---\n# First\n' }
const second = { kind: 'saveNote' as const, path: 'second.md', content: '# Second\n' }
const contents = [first, second].map(({ path, content }) => ({ path, content }))

it('persists a complete text plan once without losing frontmatter', async () => {
  const { fileSystem, repository, request } = fixture('complete')
  await repository.persistWrites([first, second], request)
  expect(fileSystem.writeTextBatch).toHaveBeenCalledExactlyOnceWith(request.vaultRootUri, contents)
  expect(fileSystem.writeTextFile).not.toHaveBeenCalled()
})

it('coalesces repeated normalized paths to their final content', async () => {
  const { fileSystem, repository, request } = fixture('coalesced')
  await repository.persistWrites([first, second, { ...first, path: ' first.md ', content: '# Final\n' }], request)
  expect(fileSystem.writeTextBatch).toHaveBeenCalledExactlyOnceWith(request.vaultRootUri,
    [{ path: 'first.md', content: '# Final\n' }, contents[1]])
})

it('validates every path before beginning the batch', async () => {
  const { fileSystem, repository, request } = fixture('invalid')
  await expect(repository.persistWrites([first, { ...second, path: '../outside.md' }], request))
    .rejects.toThrow('invalidWorkspacePath')
  expect(fileSystem.writeTextBatch).not.toHaveBeenCalled()
  expect(fileSystem.writeTextFile).not.toHaveBeenCalled()
})

it('keeps mixed move and backlink plans on the existing ordered path', async () => {
  const { fileSystem, repository, request } = fixture('mixed')
  const events: string[] = []
  fileSystem.moveTextFile = () => { events.push('move') }
  fileSystem.writeTextFile = () => { events.push('text') }
  await repository.persistWrites([{ kind: 'moveNote', path: 'old.md', toPath: 'new.md' }, first], request)
  expect(events).toEqual(['move', 'text'])
  expect(fileSystem.writeTextBatch).not.toHaveBeenCalled()
})

it('does not batch ordinary single-note saves', async () => {
  const { fileSystem, repository, request } = fixture('single')
  await repository.persistWrites([first], request)
  expect(fileSystem.writeTextFile).toHaveBeenCalledExactlyOnceWith(request.vaultRootUri, first.path, first.content)
  expect(fileSystem.writeTextBatch).not.toHaveBeenCalled()
})

it('retries the failed batch before accepting the next edit', async () => {
  const { fileSystem, repository, request } = fixture('retry')
  const events: string[] = []
  const batch = vi.fn().mockRejectedValueOnce(new Error('interrupted')).mockImplementation(async () => { events.push('batch') })
  fileSystem.writeTextBatch = batch
  fileSystem.writeTextFile = () => { events.push('next') }
  await expect(repository.persistWrites([first, second], request)).rejects.toThrow('interrupted')
  await repository.persistWrites([{ ...first, content: '# Later' }], request)
  expect(events).toEqual(['batch', 'next'])
  expect(batch.mock.calls).toEqual([[request.vaultRootUri, contents], [request.vaultRootUri, contents]])
})

it('never replays a completed fallback write when a later member fails', async () => {
  const { fileSystem, repository, request } = fixture('fallback')
  delete fileSystem.writeTextBatch
  const write = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('interrupted'))
    .mockResolvedValue(undefined)
  fileSystem.writeTextFile = write
  const writes: MobileWorkspaceWrite[] = [first, second]
  await expect(repository.persistWrites(writes, request)).rejects.toThrow('interrupted')
  await repository.persistWrites([{ ...second, content: '# Later' }], request)
  expect(write.mock.calls.map((call) => call[2])).toEqual([first.content, second.content, second.content, '# Later'])
})
