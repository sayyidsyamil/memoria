import { beforeEach, expect, it, vi } from 'vitest'
import { type Directory, File } from 'expo-file-system'
import { prepareStarterVault } from './starterVaultStorage.native'

const disk = vi.hoisted(() => ({ files: new Map<string, string>(), directories: new Set<string>() }))
vi.mock('expo-file-system', () => {
  const path = (parts: (string | { uri: string })[]) => parts.map(part => typeof part === 'string' ? part : part.uri).join('/')
  class TestDirectory {
    uri: string
    constructor(...parts: (string | { uri: string })[]) { this.uri = path(parts) }
    get exists() { return disk.directories.has(this.uri) }
    get parentDirectory() { return new TestDirectory(this.uri.slice(0, this.uri.lastIndexOf('/'))) }
    create() { disk.directories.add(this.uri) }
    list() {
      return [...disk.directories].filter(name => name.startsWith(`${this.uri}/`) && !name.slice(this.uri.length + 1).includes('/'))
        .map(name => new TestDirectory(name))
    }
    move(destination: TestDirectory) {
      if (destination.exists) throw new Error('destinationExists')
      for (const [name, content] of [...disk.files]) {
        if (!name.startsWith(`${this.uri}/`)) continue
        disk.files.set(destination.uri + name.slice(this.uri.length), content)
        disk.files.delete(name)
      }
      disk.directories.delete(this.uri)
      disk.directories.add(destination.uri)
      this.uri = destination.uri
    }
  }
  class TestFile {
    uri: string
    constructor(...parts: (string | { uri: string })[]) { this.uri = path(parts) }
    get exists() { return disk.files.has(this.uri) }
    get parentDirectory() { return new TestDirectory(this.uri.slice(0, this.uri.lastIndexOf('/'))) }
    async text() { return disk.files.get(this.uri) ?? '' }
    write(content: string) { disk.files.set(this.uri, content) }
    move(destination: TestFile) {
      if (destination.exists) throw new Error('destinationExists')
      const content = disk.files.get(this.uri)
      if (content === undefined) throw new Error('sourceMissing')
      disk.files.set(destination.uri, content)
      disk.files.delete(this.uri)
      this.uri = destination.uri
    }
  }
  return { Directory: TestDirectory, File: TestFile, Paths: { document: '/documents' } }
})

const revision = 'a'.repeat(40)
const marker = '/documents/.memoria-mobile-config/starter-vault.json'
const staging = '/documents/.memoria-mobile-config/starter-vault-staging'
const destination = '/documents/Local Vaults/getting-started'
const record = JSON.stringify({ version: 1, revision, label: 'Getting Started' })
const populate = async (directory: Directory) => { new File(directory, 'note.md').write('# Note') }
const template = { revision, label: 'Getting Started', populate }

beforeEach(() => { disk.files.clear(); disk.directories.clear() })

it('publishes a complete local-only copy before returning the catalog record', async () => {
  const vault = await prepareStarterVault(template)
  expect(vault).toEqual({ id: 'getting-started', label: 'Getting Started', directory: 'Local Vaults/getting-started' })
  expect(disk.files.get(`${destination}/note.md`)).toBe('# Note')
  expect(disk.directories.has(staging)).toBe(false)
  expect(disk.files.has(marker)).toBe(true)
})

it.each(['Memoria Vault', 'Local Vaults', 'Git Vaults'])('does not initialize over existing %s data', async path => {
  disk.directories.add(`/documents/${path}`)
  disk.files.set(`/documents/${path}/user.md`, 'User content')
  const before = [...disk.files]
  await expect(prepareStarterVault(template)).rejects.toThrow('starterVaultRecoveryRequired')
  expect([...disk.files]).toEqual(before)
})

it.each(['', '.backup', '.pending'])('does not reinterpret a prior catalog%s as a first launch', async suffix => {
  disk.files.set(`/documents/.memoria-mobile-config/git-vaults.json${suffix}`, 'existing metadata')
  expect(await prepareStarterVault(template)).toBeNull()
  expect(disk.files.size).toBe(1)
})

it('resumes an interrupted copy without publishing an incomplete vault', async () => {
  const interrupted = async (directory: Directory) => { await populate(directory); throw new Error('interrupted') }
  await expect(prepareStarterVault({ ...template, populate: interrupted })).rejects.toThrow('interrupted')
  expect(disk.directories.has(destination)).toBe(false)
  await prepareStarterVault(template)
  expect(disk.files.get(`${destination}/note.md`)).toBe('# Note')
})

it('retains edits if catalog registration failed after directory publication', async () => {
  await prepareStarterVault(template)
  disk.files.set(`${destination}/note.md`, 'Changed after publication')
  const unexpectedCopy = vi.fn(populate)
  expect(await prepareStarterVault({ ...template, populate: unexpectedCopy })).not.toBeNull()
  expect(unexpectedCopy).not.toHaveBeenCalled()
  expect(disk.files.get(`${destination}/note.md`)).toBe('Changed after publication')
})

it('serializes concurrent setup attempts and copies only once', async () => {
  const copy = vi.fn(populate)
  const first = prepareStarterVault({ ...template, populate: copy })
  const second = prepareStarterVault({ ...template, populate: copy })
  expect(await first).toEqual(await second)
  expect(copy).toHaveBeenCalledTimes(1)
})

it('recovers a complete preparation marker interrupted before its rename', async () => {
  disk.files.set(`${marker}.pending`, record)
  expect(await prepareStarterVault(template)).not.toBeNull()
  expect(disk.files.has(`${marker}.pending`)).toBe(false)
})

it('keeps corrupt preparation metadata intact instead of starting over', async () => {
  disk.files.set(marker, 'broken')
  await expect(prepareStarterVault(template)).rejects.toThrow()
  expect([...disk.files]).toEqual([[marker, 'broken']])
})

it('refuses ambiguous published and staging directories without replacing either', async () => {
  disk.files.set(marker, record)
  disk.directories.add(staging)
  disk.directories.add(destination)
  disk.files.set(`${destination}/note.md`, 'Keep this')
  await expect(prepareStarterVault(template)).rejects.toThrow('starterVaultRecoveryRequired')
  expect(disk.files.get(`${destination}/note.md`)).toBe('Keep this')
})

it('does not mix template revisions in an interrupted preparation', async () => {
  disk.files.set(marker, record)
  await expect(prepareStarterVault({ ...template, revision: 'b'.repeat(40) })).rejects.toThrow('starterVaultRecoveryRequired')
  expect(disk.directories.has(destination)).toBe(false)
})

it('does not use an old preparation marker to hide another unregistered vault', async () => {
  await prepareStarterVault(template)
  disk.directories.add('/documents/Local Vaults/other-vault')
  const before = [...disk.files]
  await expect(prepareStarterVault(template)).rejects.toThrow('starterVaultRecoveryRequired')
  expect([...disk.files]).toEqual(before)
})

it.each([null, {}, { version: 2 }, { version: 1, label: '' }, { version: 1, label: 'Starter', revision: '../other' }])(
  'rejects invalid preparation records without creating a vault', async value => {
    disk.files.set(marker, JSON.stringify(value))
    await expect(prepareStarterVault(template)).rejects.toThrow('starterVaultRecoveryRequired')
    expect(disk.directories.size).toBe(0)
  },
)

it('does not claim an orphan staging directory without its ownership marker', async () => {
  disk.directories.add(staging)
  await expect(prepareStarterVault(template)).rejects.toThrow('starterVaultRecoveryRequired')
  expect(disk.files.size).toBe(0)
})

it('does not promote a pending marker over a subsequently created catalog', async () => {
  disk.files.set(`${marker}.pending`, record)
  disk.files.set('/documents/.memoria-mobile-config/git-vaults.json', 'Existing catalog')
  await expect(prepareStarterVault(template)).rejects.toThrow('starterVaultRecoveryRequired')
  expect(disk.files.has(marker)).toBe(false)
})

it('does not overwrite a destination created while the template was copying', async () => {
  const collision = async (directory: Directory) => {
    await populate(directory)
    disk.directories.add(destination)
    disk.files.set(`${destination}/note.md`, 'Other content')
  }
  await expect(prepareStarterVault({ ...template, populate: collision })).rejects.toThrow('starterVaultRecoveryRequired')
  expect(disk.files.get(`${destination}/note.md`)).toBe('Other content')
})

it('does not recover a starter record instead of an unregistered Git vault', async () => {
  disk.files.set(marker, record)
  disk.directories.add('/documents/Git Vaults')
  await expect(prepareStarterVault(template)).rejects.toThrow('starterVaultRecoveryRequired')
  expect(disk.directories.has(destination)).toBe(false)
})
