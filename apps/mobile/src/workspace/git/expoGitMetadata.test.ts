import { expect, it, vi } from 'vitest'
import { createExpoGitFileSystem } from './expoGitFileSystem'

function metadataFixture() {
  const unsupported = () => { throw new Error('unexpectedExpoMetadataRead') }
  const module = {
    File: class {
      constructor() { unsupported() }
      bytes = async () => new Uint8Array()
      write = unsupported
      delete = unsupported
      info = unsupported
    },
    Directory: class { create = unsupported; delete = unsupported },
    Paths: { info: unsupported },
  }
  const metadata = { exists: true, isDirectory: false, size: 5, modificationTime: 12, creationTime: 11 }
  const readInfo = vi.fn(() => ({ ...metadata }))
  const readDirectory = vi.fn(async () => ['note.md'])
  const fs = createExpoGitFileSystem('file:///sandbox/Documents/Vault', module, readDirectory, readInfo).promises
  return { fs, metadata, readInfo, readDirectory }
}

it('reads all stat fields once per call without constructing an Expo file', async () => {
  const { fs, metadata, readInfo } = metadataFixture()
  const first = await fs.stat('/vault/note.md')
  expect(first).toMatchObject({ size: 5, mtimeMs: 12, ctimeMs: 11 })
  expect(first.isFile()).toBe(true)
  expect(first.isDirectory()).toBe(false)
  expect(readInfo).toHaveBeenCalledExactlyOnceWith('file:///sandbox/Documents/Vault/note.md')
  Object.assign(metadata, { size: 9, modificationTime: 15, creationTime: 14 })
  expect(await fs.lstat('/vault/note.md')).toMatchObject({ size: 9, mtimeMs: 15, ctimeMs: 14 })
  expect(readInfo).toHaveBeenCalledTimes(2)
})

it('uses native existence and directory metadata without creating child handles', async () => {
  const { fs, metadata, readInfo, readDirectory } = metadataFixture()
  metadata.isDirectory = true
  const stat = await fs.stat('/vault')
  expect(stat.isDirectory()).toBe(true)
  expect(stat.isFile()).toBe(false)
  expect(await fs.readdir('/vault')).toEqual(['note.md'])
  expect(readInfo).toHaveBeenCalledTimes(2)
  expect(readDirectory).toHaveBeenCalledExactlyOnceWith('file:///sandbox/Documents/Vault/')
})

it('does not hide native access failures or reuse stale existence', async () => {
  const { fs, metadata, readInfo } = metadataFixture()
  await fs.stat('/vault/note.md')
  metadata.exists = false
  await expect(fs.stat('/vault/note.md')).rejects.toMatchObject({ code: 'ENOENT' })
  readInfo.mockImplementation(() => { throw new Error('symbolicLink') })
  await expect(fs.stat('/vault/note.md')).rejects.toThrow('symbolicLink')
})
