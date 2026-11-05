import { Buffer } from 'buffer'
import { expect, it } from 'vitest'
import { createExpoGitFileSystem } from './expoGitFileSystem'

function fixture() {
  const counts = { constructed: 0, reads: 0, version: 1 }
  const info = () => ({ exists: true, isDirectory: false, size: 1, modificationTime: counts.version, creationTime: 1 })
  const module = {
    File: class {
      constructor() { counts.constructed++ }
      bytes = async () => { counts.reads++; return new Uint8Array([counts.version]) }
      write = () => {}
      delete = () => {}
      info = info
    },
    Directory: class { create = () => {}; delete = () => {} },
    Paths: { info },
  }
  const fs = createExpoGitFileSystem('file:///fixture', module, async () => [], info).promises
  return { fs, counts }
}

it('reuses handles across full 9000-note passes without caching any bytes', async () => {
  const { fs, counts } = fixture()
  for (let index = 0; index < 9000; index++) await fs.readFile(`/vault/note-${index}.md`)
  counts.version = 2
  for (let index = 0; index < 9000; index++) {
    expect(await fs.readFile(`/vault/note-${index}.md`)).toEqual(Buffer.from([2]))
  }
  expect(counts.reads).toBe(18000)
  expect(counts.constructed).toBe(9000)
})

it('still bounds retention after more than 16384 distinct file handles', async () => {
  const { fs, counts } = fixture()
  for (let index = 0; index < 16385; index++) await fs.readFile(`/vault/note-${index}.md`)
  await fs.readFile('/vault/note-0.md')
  expect(counts.constructed).toBe(16386)
  expect(counts.reads).toBe(16386)
})
