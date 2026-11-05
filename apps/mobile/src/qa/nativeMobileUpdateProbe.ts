import type { MobileTelemetryContext } from '../analytics/mobileTelemetryContext'

export function logNativeMobileUpdateProof(marker: unknown, context: MobileTelemetryContext) {
  if (context.ota_channel !== 'ota-validation') return
  if (typeof marker !== 'string' || !['embedded-a', 'update-b', 'wrong-runtime', 'rollback'].includes(marker)) return
  console.info(`MEMORIA_MOBILE_OTA_PROOF ${JSON.stringify({ marker,
    updateId: context.ota_update_id, runtime: context.ota_runtime_version,
    channel: context.ota_channel, source: context.ota_launch_source, emergency: context.ota_emergency_launch,
  })}`)
}
