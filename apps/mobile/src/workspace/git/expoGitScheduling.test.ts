import { afterEach, expect, it, vi } from 'vitest'
import { createExpoGitFileSystem } from './expoGitFileSystem'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

function fixture() {
  vi.useFakeTimers()
  const now = vi.spyOn(performance, 'now').mockReturnValue(0)
  const write = vi.fn()
  const remove = vi.fn()
  const create = vi.fn()
  const metadata = { size: 5, modificationTime: 12, creationTime: 11 }
  const readInfo = vi.fn((uri: string) => ({
    ...metadata,
    exists: !uri.endsWith('/created'),
    isDirectory: /\/Vault\/?$/u.test(uri),
  }))
  const module = {
    File: class {
      bytes = async () => new Uint8Array()
      write = write
      delete = remove
      info = () => ({ ...metadata, exists: true })
    },
    Directory: class { create = create; delete = remove },
    Paths: { info: readInfo },
  }
  const fs = createExpoGitFileSystem('file:///sandbox/Documents/Vault', module, async () => [], readInfo).promises
  now.mockReturnValue(17)
  return { fs, metadata, now, readInfo }
}

type GitFiles = ReturnType<typeof createExpoGitFileSystem>['promises']
const operations = [
  { name: 'stat', run: (fs: GitFiles) => fs.stat('/vault/note.md') },
  { name: 'lstat', run: (fs: GitFiles) => fs.lstat('/vault/note.md') },
  { name: 'write', run: (fs: GitFiles) => fs.writeFile('/vault/note.md', 'new') },
  { name: 'remove', run: (fs: GitFiles) => fs.unlink('/vault/note.md') },
  { name: 'mkdir', run: (fs: GitFiles) => fs.mkdir('/vault/created') },
  { name: 'read', run: (fs: GitFiles) => fs.readFile('/vault/note.md') },
  { name: 'readdir', run: (fs: GitFiles) => fs.readdir('/vault') },
  { name: 'rmdir', run: (fs: GitFiles) => fs.rmdir('/vault') },
]

it.each(operations)(
  '$name gives the event loop a turn before more synchronous native work', async ({ run }) => {
    const { fs, readInfo } = fixture()
    const result = run(fs)
    await Promise.resolve()
    expect(readInfo).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(0)
    await result
    expect(readInfo).toHaveBeenCalled()
  },
)

it('reads fresh metadata after the pause rather than caching the pre-yield value', async () => {
  const { fs, metadata } = fixture()
  const result = fs.stat('/vault/note.md')
  metadata.size = 99
  await vi.advanceTimersByTimeAsync(0)
  expect(await result).toMatchObject({ size: 99 })
})

it('preserves native errors after yielding', async () => {
  const { fs, readInfo } = fixture()
  readInfo.mockImplementation(() => { throw new Error('symbolicLink') })
  const result = expect(fs.stat('/vault/note.md')).rejects.toThrow('symbolicLink')
  await vi.advanceTimersByTimeAsync(0)
  await result
})

it('splits a concurrent metadata burst into separate work budgets', async () => {
  const { fs, now, readInfo } = fixture()
  let elapsed = 17
  now.mockImplementation(() => elapsed)
  readInfo.mockImplementation(() => {
    elapsed += 8
    return { exists: true, isDirectory: false, size: 1, modificationTime: 0, creationTime: 0 }
  })
  const timers = vi.spyOn(globalThis, 'setTimeout')
  const reads = Array.from({ length: 12 }, () => fs.stat('/vault/note.md'))
  await vi.runAllTimersAsync()
  await Promise.all(reads)
  expect(readInfo).toHaveBeenCalledTimes(12)
  expect(timers).toHaveBeenCalledTimes(6)
})

it.each([
  { name: 'byte read', read: (fs: GitFiles) => fs.readFile('/vault/note.md') },
  { name: 'directory read', read: (fs: GitFiles) => fs.readdir('/vault') },
])('preserves the task budget across a native $name', async ({ read }) => {
  const { fs, now } = fixture()
  const result = read(fs)
  expect(vi.getTimerCount()).toBe(1)
  await vi.advanceTimersByTimeAsync(0)
  await result
  now.mockReturnValue(34)
  const stat = fs.stat('/vault/note.md')
  expect(vi.getTimerCount()).toBe(1)
  await vi.advanceTimersByTimeAsync(0)
  await stat
})

it('yields to input during 6,000 failed file existence checks', async () => {
  const { fs, now, readInfo } = fixture()
  let elapsed = 0
  let completed = 0
  now.mockImplementation(() => elapsed)
  readInfo.mockImplementation(() => {
    elapsed += 1
    return { exists: false, isDirectory: false, size: 0, modificationTime: 0, creationTime: 0 }
  })
  const input = vi.fn(() => completed)
  setTimeout(input, 0)
  const reads = (async () => {
    for (let index = 0; index < 6000; index += 1) {
      await expect(fs.readFile('/vault/missing.md')).rejects.toMatchObject({ code: 'ENOENT' })
      completed += 1
    }
  })()
  await vi.runAllTimersAsync()
  await reads
  expect(input).toHaveReturnedWith(16)
  expect(completed).toBe(6000)
})
