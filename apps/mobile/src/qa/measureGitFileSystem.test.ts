import { Buffer } from 'buffer'
import { afterEach, expect, it, vi } from 'vitest'
import type { gitFileSystemSession } from '../workspace/git/gitFileSystemSessions'
import { measureGitFileSystem } from './measureGitFileSystem'

type Operations = ReturnType<typeof gitFileSystemSession>['promises']
type ReadResult = Awaited<ReturnType<Operations['readFile']>>

afterEach(() => vi.restoreAllMocks())

it('uses the monotonic clock by default and forwards directory operations', async () => {
  vi.spyOn(performance, 'now').mockReturnValueOnce(10).mockReturnValueOnce(18)
  const fs = fileSystem()
  fs.promises.mkdir.mockResolvedValue(undefined)
  const measured = measureGitFileSystem(fs)
  await measured.fs.promises.mkdir('/private/directory')
  expect(fs.promises.mkdir).toHaveBeenCalledWith('/private/directory')
  expect(measured.snapshot().find(entry => entry.method === 'mkdir'))
    .toEqual({ method: 'mkdir', calls: 1, failures: 0, cumulativeMs: 8 })
})

it('forwards arguments, receiver and bounded bytes without copying or caching', async () => {
  let now = 0
  const fs = fileSystem()
  const bytes = Buffer.from([9, 0, 255, 8]).subarray(1, 3)
  fs.promises.readFile.mockImplementation(async () => { now += 7; return bytes })
  const measured = measureGitFileSystem(fs, () => now)
  const encoding = { encoding: 'utf8' }
  const initial = measured.snapshot()
  expect(await measured.fs.promises.readFile('/private/note', encoding)).toBe(bytes)
  expect(await measured.fs.promises.readFile('/private/note', encoding)).toBe(bytes)
  expect(fs.promises.readFile.mock.contexts).toEqual([fs.promises, fs.promises])
  expect(fs.promises.readFile).toHaveBeenLastCalledWith('/private/note', encoding)
  expect(measured.snapshot().find(entry => entry.method === 'readFile'))
    .toEqual({ method: 'readFile', calls: 2, failures: 0, cumulativeMs: 14 })
  expect(initial.find(entry => entry.method === 'readFile')?.calls).toBe(0)
  await measured.fs.promises.writeFile('/private/bytes', bytes)
  expect(fs.promises.writeFile).toHaveBeenCalledWith('/private/bytes', bytes)
})

it('measures overlapping waits independently rather than reporting CPU or wall time', async () => {
  let now = 0
  const fs = fileSystem()
  const first = deferredRead()
  const second = deferredRead()
  fs.promises.readFile.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
  const measured = measureGitFileSystem(fs, () => now)
  const pendingFirst = measured.fs.promises.readFile('first')
  now = 10
  const pendingSecond = measured.fs.promises.readFile('second')
  now = 25
  second.resolve(Buffer.from('second'))
  await pendingSecond
  now = 40
  first.resolve(Buffer.from('first'))
  await pendingFirst
  expect(measured.snapshot().find(entry => entry.method === 'readFile'))
    .toEqual({ method: 'readFile', calls: 2, failures: 0, cumulativeMs: 55 })
})

it('preserves rejection identity and never records paths, contents or error text', async () => {
  const fs = fileSystem()
  const error = new Error('private failure detail')
  fs.promises.readFile.mockRejectedValue(error)
  const measured = measureGitFileSystem(fs, () => 0)
  await expect(measured.fs.promises.readFile('/private/note')).rejects.toBe(error)
  const report = measured.snapshot()
  expect(report.find(entry => entry.method === 'readFile'))
    .toEqual({ method: 'readFile', calls: 1, failures: 1, cumulativeMs: 0 })
  expect(JSON.stringify(report)).not.toMatch(/private|failure detail/)
  expect(report.every(entry => Object.keys(entry).sort().join(',') === 'calls,cumulativeMs,failures,method')).toBe(true)
})

function deferredRead() {
  let resolve: (value: ReadResult) => void = () => {}
  const promise = new Promise<ReadResult>(complete => { resolve = complete })
  return { promise, resolve: (value: ReadResult) => resolve(value) }
}

function fileSystem() {
  return { promises: {
    readFile: vi.fn<Operations['readFile']>(),
    writeFile: vi.fn<Operations['writeFile']>(),
    unlink: vi.fn<Operations['unlink']>(),
    readdir: vi.fn<Operations['readdir']>(),
    mkdir: vi.fn<Operations['mkdir']>(),
    rmdir: vi.fn<Operations['rmdir']>(),
    stat: vi.fn<Operations['stat']>(),
    lstat: vi.fn<Operations['lstat']>(),
    readlink: vi.fn<Operations['readlink']>(),
    symlink: vi.fn<Operations['symlink']>(),
  } }
}
