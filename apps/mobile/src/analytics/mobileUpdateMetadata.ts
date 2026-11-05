export type MobileUpdateContext = Pick<typeof import('expo-updates'),
  'isEnabled' | 'updateId' | 'runtimeVersion' | 'channel' | 'isEmbeddedLaunch' | 'isEmergencyLaunch'>

export function mobileUpdateMetadata(updates: MobileUpdateContext) {
  return {
    ota_update_id: identifier(updates.updateId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/),
    ota_runtime_version: identifier(updates.runtimeVersion, /^[a-f0-9]{40,64}$/),
    ota_channel: ['alpha', 'stable', 'ota-validation'].find(channel => channel === updates.channel) ?? 'unknown',
    ota_launch_source: launchSource(updates),
    ota_emergency_launch: updates.isEmergencyLaunch ? 'true' : 'false',
  }
}

function identifier(value: string | null | undefined, pattern: RegExp) {
  return value && pattern.test(value) ? value : 'unknown'
}

function launchSource(updates: MobileUpdateContext) {
  if (!updates.isEnabled) return 'disabled'
  return updates.isEmbeddedLaunch ? 'embedded' : 'downloaded'
}
