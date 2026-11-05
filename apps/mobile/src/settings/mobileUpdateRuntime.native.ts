import * as Updates from 'expo-updates'
import { nativeApplicationVersion, nativeBuildVersion } from 'expo-application'
import type { MobileUpdateRuntime } from './mobileUpdateChannel.types'

export const mobileUpdateRuntime: MobileUpdateRuntime = {
  available: Updates.isEnabled && (Updates.channel === 'alpha' || Updates.channel === 'stable'),
  channel: Updates.channel,
  updateId: Updates.updateId,
  appVersion: nativeApplicationVersion,
  buildVersion: nativeBuildVersion,
  runtimeVersion: Updates.runtimeVersion,
  isEmbeddedLaunch: Updates.isEmbeddedLaunch,
  setChannel: channel => Updates.setUpdateRequestHeadersOverride({ 'expo-channel-name': channel }),
  check: async () => {
    const update = await Updates.checkForUpdateAsync()
    validateUpdateCheck(update)
    return update.isAvailable
  },
  fetch: async () => {
    const update = await Updates.fetchUpdateAsync()
    return update.isNew && !update.isRollBackToEmbedded && Boolean(update.manifest.id)
  },
  reload: () => Updates.reloadAsync(),
}

function validateUpdateCheck(update: { isAvailable: boolean; isRollBackToEmbedded?: boolean; reason?: string }) {
  if (update.isRollBackToEmbedded) throw new Error('updateRollbackPending')
  if (update.isAvailable) return
  if (![undefined, 'noUpdateAvailableOnServer', 'updateRejectedBySelectionPolicy'].includes(update.reason)) {
    throw new Error('updateCheckRejected')
  }
}
