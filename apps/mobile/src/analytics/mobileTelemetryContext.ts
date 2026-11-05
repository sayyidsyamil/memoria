import { mobileUpdateMetadata, type MobileUpdateContext } from './mobileUpdateMetadata'

type Input = { platform: string; deviceFamily?: string; version?: string | null; build?: string | null; channel?: string; distribution?: string; updates?: MobileUpdateContext }
export type MobileTelemetryContext = ReturnType<typeof mobileTelemetryContext>

export function mobileTelemetryContext(input: Input) {
  return {
    app_surface: 'mobile',
    platform: choice(input.platform, ['ios', 'android', 'web'], 'unknown'),
    device_family: choice(input.deviceFamily, ['phone', 'tablet', 'desktop'], 'unknown'),
    app_version: version(input.version),
    build_number: version(input.build),
    release_channel: choice(input.updates?.channel ?? undefined, ['alpha', 'stable'], choice(input.channel, ['alpha', 'stable'], 'alpha')),
    distribution: choice(input.distribution, ['internal', 'testflight', 'store'], 'internal'),
    ...(input.updates ? mobileUpdateMetadata(input.updates) : {}),
  }
}

function choice(value: string | undefined, allowed: string[], fallback: string) {
  return allowed.find(candidate => candidate === value) ?? fallback
}

function version(value: string | null | undefined) {
  return value && value.length <= 40 && /^\d+[\d.a-z-]*$/.test(value) ? value : 'unknown'
}
