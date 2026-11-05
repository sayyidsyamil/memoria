import { beforeEach, expect, it, vi } from 'vitest'
import { readManagedCatalogFile, writeManagedCatalogFile } from './managedCatalogFile.native'

const disk = vi.hoisted(() => ({ files: new Map<string, string>(), failPublish: false }))
vi.mock('expo-file-system', () => ({
  Paths: { document: '/documents' },
  File: class {
    uri: string
    constructor(...parts: string[]) { this.uri = parts.join('/') }
    get exists() { return disk.files.has(this.uri) }
    get parentDirectory() { return { create: () => {} } }
    async text() { return disk.files.get(this.uri) ?? '' }
    write(value: string) { disk.files.set(this.uri, value) }
    delete() { disk.files.delete(this.uri) }
    move(target: { uri: string }) {
      if (disk.failPublish && this.uri.endsWith('.pending')) throw new Error('interrupted')
      const content = disk.files.get(this.uri)
      if (content === undefined) throw new Error('sourceMissing')
      disk.files.set(target.uri, content)
      disk.files.delete(this.uri)
      this.uri = target.uri
    }
  },
}))

const catalog = { vaults: [{ id: 'vault-1', label: 'Notes', repositoryUrl: 'https://github.com/team/notes.git' }], activeId: 'vault-1' }
beforeEach(() => { disk.files.clear(); disk.failPublish = false })

it('recovers the last complete catalog if publication is interrupted', async () => {
  await writeManagedCatalogFile(catalog)
  disk.failPublish = true
  await expect(writeManagedCatalogFile({ ...catalog, activeId: null })).rejects.toThrow('interrupted')
  expect(await readManagedCatalogFile()).toEqual(catalog)
  disk.failPublish = false
  await writeManagedCatalogFile({ ...catalog, activeId: null })
  expect((await readManagedCatalogFile()).activeId).toBeNull()
})

it('never silently resets a corrupt catalog that has no valid backup', async () => {
  disk.files.set('/documents/.memoria-mobile-config/git-vaults.json', 'broken')
  await expect(readManagedCatalogFile()).rejects.toThrow('vaultCatalogInvalid')
})

it('recovers the first catalog when the process stopped before its first rename', async () => {
  disk.failPublish = true
  await expect(writeManagedCatalogFile(catalog)).rejects.toThrow('interrupted')
  const before = [...disk.files]
  expect(await readManagedCatalogFile()).toEqual(catalog)
  expect([...disk.files]).toEqual(before)
  disk.failPublish = false
  await writeManagedCatalogFile(catalog)
  expect(await readManagedCatalogFile()).toEqual(catalog)
})

it('does not treat a corrupt first pending catalog as a fresh installation', async () => {
  disk.files.set('/documents/.memoria-mobile-config/git-vaults.json.pending', 'incomplete')
  const before = [...disk.files]
  await expect(readManagedCatalogFile()).rejects.toThrow('vaultCatalogInvalid')
  expect([...disk.files]).toEqual(before)
})

it('prefers a published catalog over an uncommitted pending replacement', async () => {
  await writeManagedCatalogFile(catalog)
  disk.files.set('/documents/.memoria-mobile-config/git-vaults.json.pending', JSON.stringify({ vaults: [], activeId: null }))
  expect(await readManagedCatalogFile()).toEqual(catalog)
})

it('returns an empty catalog only when no saved copy exists', async () => {
  expect(await readManagedCatalogFile()).toEqual({ vaults: [], activeId: null })
})

it('recovers a valid backup when the published catalog is corrupt', async () => {
  disk.files.set('/documents/.memoria-mobile-config/git-vaults.json', 'broken')
  disk.files.set('/documents/.memoria-mobile-config/git-vaults.json.backup', JSON.stringify(catalog))
  expect(await readManagedCatalogFile()).toEqual(catalog)
  await writeManagedCatalogFile({ ...catalog, activeId: null })
  expect((await readManagedCatalogFile()).activeId).toBeNull()
  expect(JSON.parse(disk.files.get('/documents/.memoria-mobile-config/git-vaults.json.backup') ?? '')).toEqual(catalog)
})

it('refuses a replacement when the prior catalog has no valid recovery copy', async () => {
  disk.files.set('/documents/.memoria-mobile-config/git-vaults.json', 'broken')
  await expect(writeManagedCatalogFile(catalog)).rejects.toThrow('vaultCatalogInvalid')
  expect(disk.files.get('/documents/.memoria-mobile-config/git-vaults.json')).toBe('broken')
})

it('retains the most recent valid catalog when rotating an older backup', async () => {
  await writeManagedCatalogFile(catalog)
  await writeManagedCatalogFile({ ...catalog, activeId: null })
  await writeManagedCatalogFile(catalog)
  expect(JSON.parse(disk.files.get('/documents/.memoria-mobile-config/git-vaults.json.backup') ?? '').activeId).toBeNull()
})
