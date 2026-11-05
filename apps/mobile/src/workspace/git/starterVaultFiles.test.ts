import { beforeEach, expect, it, vi } from 'vitest'
import { createHash, webcrypto } from 'node:crypto'
import { Directory, File } from 'expo-file-system'
import { populateStarterVaultFiles } from './starterVaultFiles.native'

const disk = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), writes: [] as string[], corruptWrite: false }))
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: async (_algorithm: string, bytes: Uint8Array) => webcrypto.subtle.digest('SHA-256', Uint8Array.from(bytes)),
}))
vi.mock('expo-file-system', () => {
  const uri = (parts: (string | { uri: string })[]) => parts.map(part => typeof part === 'string' ? part : part.uri).join('/')
  return {
    Directory: class { uri: string; constructor(...parts: (string | { uri: string })[]) { this.uri = uri(parts) } },
    File: class {
      uri: string
      constructor(...parts: (string | { uri: string })[]) { this.uri = uri(parts) }
      get exists() { return disk.files.has(this.uri) }
      get parentDirectory() { return { create: () => {} } }
      async bytes() { return readBytes(this.uri) }
      write(text: string) {
        disk.writes.push(this.uri)
        disk.files.set(this.uri, Buffer.from(disk.corruptWrite ? 'damaged' : text))
      }
      copy(target: { uri: string }) {
        const bytes = readBytes(this.uri)
        if (disk.files.has(target.uri)) throw new Error('targetExists')
        disk.writes.push(target.uri)
        disk.files.set(target.uri, Uint8Array.from(bytes))
      }
      delete() { disk.files.delete(this.uri) }
    },
  }
})

function readBytes(uri: string) {
  const bytes = disk.files.get(uri)
  if (!bytes) throw new Error('fileMissing')
  return Uint8Array.from(bytes)
}

const root = new Directory('file:///staging')
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const textFile = (path = 'note.md', text = '# Note\n') => ({ path, text, sha256: hash(text) })
const image = Uint8Array.from([137, 80, 78, 71, 0, 255])
const imageFile = { path: 'attachments/picture.png', asset: 'images/image.png', sha256: hash(image) }
const resolveAsset = vi.fn(async () => new File('file:///bundle/image.png'))
beforeEach(() => {
  disk.files.clear()
  disk.writes.length = 0
  disk.corruptWrite = false
  resolveAsset.mockClear()
  disk.files.set('file:///bundle/image.png', image)
})

it('copies text and binary assets byte-for-byte under their original paths', async () => {
  await populateStarterVaultFiles(root, { files: [textFile('views/active.yml', 'name: Active\n'), imageFile], resolveAsset })
  expect(Buffer.from(disk.files.get('file:///staging/views/active.yml') ?? []).toString()).toBe('name: Active\n')
  expect(disk.files.get('file:///staging/attachments/picture.png')).toEqual(image)
  expect(resolveAsset).toHaveBeenCalledWith('attachments/picture.png')
})

it('reuses verified staged files when an interrupted copy is retried', async () => {
  const source = { files: [textFile(), imageFile], resolveAsset }
  await populateStarterVaultFiles(root, source)
  disk.writes.length = 0
  resolveAsset.mockClear()
  await populateStarterVaultFiles(root, source)
  expect(disk.writes).toEqual([])
  expect(resolveAsset).not.toHaveBeenCalled()
})

it('replaces only incomplete staging files and leaves unrelated files alone', async () => {
  disk.files.set('file:///staging/attachments/picture.png', Buffer.from('partial'))
  disk.files.set('file:///other-vault/note.md', Buffer.from('User content'))
  await populateStarterVaultFiles(root, { files: [imageFile], resolveAsset })
  expect(disk.files.get('file:///staging/attachments/picture.png')).toEqual(image)
  expect(Buffer.from(disk.files.get('file:///other-vault/note.md') ?? []).toString()).toBe('User content')
})

it('fails before publication if a packaged asset does not match its checksum', async () => {
  disk.files.set('file:///bundle/image.png', Buffer.from('damaged'))
  await expect(populateStarterVaultFiles(root, { files: [imageFile], resolveAsset })).rejects.toThrow('starterVaultBundleInvalid')
})

it('detects a truncated text write by reading back the native file', async () => {
  disk.corruptWrite = true
  await expect(populateStarterVaultFiles(root, { files: [textFile()], resolveAsset })).rejects.toThrow('starterVaultBundleInvalid')
})

it('propagates asset resolution failures instead of accepting an incomplete vault', async () => {
  const missing = async () => { throw new Error('assetMissing') }
  await expect(populateStarterVaultFiles(root, { files: [imageFile], resolveAsset: missing })).rejects.toThrow('assetMissing')
})

it.each(['../escape.md', '/absolute.md', 'folder//note.md', './note.md', '.git/config', 'bad\\name.md'])('rejects invalid path %s before any write', async path => {
  await expect(populateStarterVaultFiles(root, { files: [textFile(), textFile(path)], resolveAsset })).rejects.toThrow('starterVaultBundleInvalid')
  expect(disk.writes).toEqual([])
})

it('rejects duplicate paths before any write', async () => {
  await expect(populateStarterVaultFiles(root, { files: [textFile(), textFile()], resolveAsset })).rejects.toThrow('starterVaultBundleInvalid')
  expect(disk.writes).toEqual([])
})

it('does not accept an empty template as a completed copy', async () => {
  await expect(populateStarterVaultFiles(root, { files: [], resolveAsset })).rejects.toThrow('starterVaultBundleInvalid')
  expect(disk.writes).toEqual([])
})

it.each([
  { path: 'note.md', sha256: 'invalid', text: 'content' },
  { path: 'note.md', sha256: hash('') },
  { path: 'note.md', sha256: hash(''), text: '', asset: 'image.png' },
])('rejects malformed file declarations before writing', async file => {
  await expect(populateStarterVaultFiles(root, { files: [file], resolveAsset })).rejects.toThrow('starterVaultBundleInvalid')
  expect(disk.writes).toEqual([])
})
