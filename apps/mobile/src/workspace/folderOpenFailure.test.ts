import { expect, it, vi } from 'vitest'
import { createMobileAnalytics, type MobileAnalyticsEvent } from '../analytics/mobileAnalytics'
import { folderOpenMessage, folderOpenStep, FolderOpenFailure, isFolderPickerCancellation } from './folderOpenFailure'
import { pickNativeWorkspaceDirectoryWithDependencies, pickNativeWorkspaceDirectoryWithPicker } from './nativeWorkspacePicker'

it.each(['ERR_FILE_PICKING_CANCELLED', 'ERR_PICKER_CANCELLED'])(
  'recognizes the explicit %s cancellation code', async (code) => {
    const failure = Object.assign(new Error('provider-localized cancellation'), { code })
    expect(isFolderPickerCancellation(failure)).toBe(true)
    expect(await pickNativeWorkspaceDirectoryWithPicker(async () => { throw failure })).toBeNull()
  },
)

it('retains legacy exact cancellation while rejecting unrelated or malformed errors', () => {
  expect(isFolderPickerCancellation(new Error('cancelled'))).toBe(true)
  for (const failure of [null, undefined, {}, 'cancelled', new Error('access denied'),
    Object.assign(new Error('cancelled'), { code: 'ERR_PERMISSION_DENIED' })]) {
    expect(isFolderPickerCancellation(failure)).toBe(false)
  }
})

it('does not treat an invalid picker result as cancellation', async () => {
  await expect(pickNativeWorkspaceDirectoryWithPicker(async () => ({ uri: ' ' })))
    .rejects.toMatchObject({ stage: 'picker' })
})

it('does not silently treat provider or presentation failure as cancelling the picker', async () => {
  const failure = Object.assign(new Error('/private/provider/notes could not be opened'), { code: 'ERR_MISSING_VIEW_CONTROLLER' })
  const result = pickNativeWorkspaceDirectoryWithPicker(async () => { throw failure })
  await expect(result).rejects.toMatchObject({ stage: 'picker', cause: failure, message: 'folderOpenFailed' })
})

it('distinguishes native selected-folder import failure from picker failure', async () => {
  const failure = new Error('private document could not be read')
  const picker = vi.fn()
  const module = {
    importWorkspace: vi.fn(), restoreWorkspace: vi.fn(),
    pickAndImportWorkspace: vi.fn().mockRejectedValue(failure),
  }
  await expect(pickNativeWorkspaceDirectoryWithDependencies(picker, module))
    .rejects.toMatchObject({ stage: 'import', cause: failure })
  expect(picker).not.toHaveBeenCalled()
  module.pickAndImportWorkspace.mockResolvedValue(null)
  expect(await pickNativeWorkspaceDirectoryWithDependencies(picker, module)).toBeNull()
})

it('passes successful step values through without wrapping them', async () => {
  const value = { untouched: true }
  expect(await folderOpenStep('catalog', async () => value)).toBe(value)
})

it('keeps an inner failure stage and retains the original cause locally', async () => {
  const cause = new Error('private file content must not become a label')
  const original = new FolderOpenFailure('import', cause)
  await expect(folderOpenStep('picker', async () => { throw original })).rejects.toBe(original)
  await expect(folderOpenStep('prepare', async () => { throw cause }))
    .rejects.toMatchObject({ stage: 'prepare', cause, message: 'folderOpenFailed' })
})

it.each([
  { stage: 'picker', key: 'mobile.vaults.folderPickerFailed' },
  { stage: 'import', key: 'mobile.vaults.folderReadFailed' },
  { stage: 'prepare', key: 'mobile.vaults.folderReadFailed' },
  { stage: 'catalog', key: 'mobile.vaults.folderCatalogFailed' },
] as const)('selects folder-specific copy for $stage without a GitHub error', ({ stage, key }) => {
  expect(folderOpenMessage(new FolderOpenFailure(stage, new Error('private')))).toBe(key)
})

it('emits no folder diagnostic before consent and only the stage after consent', () => {
  const send = vi.fn(async () => {})
  const analytics = createMobileAnalytics({ configured: true, createId: () => 'session', platform: 'ios', send })
  const event: MobileAnalyticsEvent & { uri: string; error: string } = {
    name: 'mobile_folder_open_failed', stage: 'import', uri: 'file:///private/vault', error: 'private note name',
  }
  analytics.capture(event)
  expect(send).not.toHaveBeenCalled()
  analytics.setEnabled(true)
  analytics.capture(event)
  expect(send).toHaveBeenCalledWith({ event: 'mobile_folder_open_failed', distinct_id: 'session', properties: {
    $process_person_profile: false, $geoip_disable: true, platform: 'ios', stage: 'import',
  } }, expect.any(AbortSignal))
  analytics.setEnabled(false)
})
