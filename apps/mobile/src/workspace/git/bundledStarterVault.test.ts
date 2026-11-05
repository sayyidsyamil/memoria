import { beforeEach, expect, it, vi } from 'vitest'
import manifest from '../../../assets/starter-vault/manifest.json'
import { prepareBundledStarterVault } from './bundledStarterVault.native'

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(), populate: vi.fn(), sources: vi.fn(), fromModule: vi.fn(), fromURI: vi.fn(),
}))
vi.mock('./starterVaultStorage.native', () => ({ prepareStarterVault: mocks.prepare }))
vi.mock('./starterVaultFiles.native', () => ({ populateStarterVaultFiles: mocks.populate }))
vi.mock('../../../assets/starter-vault/images', () => ({ starterImageSources: mocks.sources }))
vi.mock('expo-asset', () => ({ Asset: { fromModule: mocks.fromModule, fromURI: mocks.fromURI } }))
vi.mock('expo-file-system', () => ({ File: class { constructor(public uri: string) {} } }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.sources.mockReturnValue({ 'attachments/image.png': 42 })
  mocks.prepare.mockImplementation(async template => {
    await template.populate({ uri: 'file:///staging/' })
    return { id: 'getting-started' }
  })
})

it('uses the canonical revision and complete manifest inside the safe preparation boundary', async () => {
  expect(await prepareBundledStarterVault()).toEqual({ id: 'getting-started' })
  expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ label: manifest.label, revision: manifest.revision }))
  expect(mocks.populate).toHaveBeenCalledWith({ uri: 'file:///staging/' }, expect.objectContaining({ files: manifest.files }))
})

it('never resolves bundled images when an existing published vault can be reused', async () => {
  mocks.prepare.mockResolvedValue({ id: 'existing' })
  expect(await prepareBundledStarterVault()).toEqual({ id: 'existing' })
  expect(mocks.sources).not.toHaveBeenCalled()
  expect(mocks.populate).not.toHaveBeenCalled()
})

it.each(['localUri', 'uri'])('uses an embedded file URI without any download (%s)', async key => {
  const asset = { uri: 'asset://image', localUri: null, downloadAsync: vi.fn(), [key]: 'file:///bundle/image.png' }
  mocks.fromModule.mockReturnValue(asset)
  await prepareBundledStarterVault()
  expect((await resolveImage()).uri).toBe('file:///bundle/image.png')
  expect(mocks.fromModule).toHaveBeenCalledWith(42)
  expect(asset.downloadAsync).not.toHaveBeenCalled()
})

it('materializes Android drawable resources as local files instead of treating their names as paths', async () => {
  mocks.fromModule.mockReturnValue({ uri: 'asset_image', localUri: 'asset_image' })
  const resource = { localUri: null as string | null, downloadAsync: vi.fn(async () => { resource.localUri = 'file:///cache/image.png' }) }
  mocks.fromURI.mockReturnValue(resource)
  await prepareBundledStarterVault()
  expect((await resolveImage()).uri).toBe('file:///cache/image.png')
  expect(mocks.fromURI).toHaveBeenCalledWith('asset_image')
  expect(resource.downloadAsync).toHaveBeenCalledOnce()
})

it('uses the Expo asset resolver for uncached development assets', async () => {
  const asset = { uri: 'http://localhost:8081/image.png', localUri: null as string | null,
    downloadAsync: vi.fn(async () => { asset.localUri = 'file:///cache/image.png' }) }
  mocks.fromModule.mockReturnValue(asset)
  await prepareBundledStarterVault()
  expect((await resolveImage()).uri).toBe('file:///cache/image.png')
  expect(asset.downloadAsync).toHaveBeenCalledOnce()
})

it('rejects missing modules before resolving them', async () => {
  mocks.sources.mockReturnValue({})
  await prepareBundledStarterVault()
  await expect(resolveImage()).rejects.toThrow('starterVaultBundleInvalid')
  expect(mocks.fromModule).not.toHaveBeenCalled()
})

it('propagates materialization failures without publishing', async () => {
  mocks.fromModule.mockReturnValue({ uri: 'asset://image', localUri: null, downloadAsync: vi.fn().mockRejectedValue(new Error('assetUnavailable')) })
  mocks.populate.mockImplementation(async (_directory, source) => { await source.resolveAsset('attachments/image.png') })
  await expect(prepareBundledStarterVault()).rejects.toThrow('assetUnavailable')
})

it('rejects a resolver result that is not a local file', async () => {
  mocks.fromModule.mockReturnValue({ uri: 'asset://image', localUri: null, downloadAsync: vi.fn() })
  await prepareBundledStarterVault()
  await expect(resolveImage()).rejects.toThrow('starterVaultBundleInvalid')
})

function resolveImage(): Promise<{ uri: string }> {
  return mocks.populate.mock.calls[0][1].resolveAsset('attachments/image.png')
}
