import { resolveFrontendTelemetryConfig, type FrontendTelemetryConfig } from './telemetryConfig'

/**
 * First-run interruptions inherited from Tolaria that have nothing to do with Memoria's
 * meeting flow. Set to true to bring back the "AI agents" setup prompt at first launch.
 */
export const SHOW_AI_ONBOARDING_PROMPTS = false

/** True only when this build contains a Sentry DSN or a PostHog key, i.e. when anything could be sent. */
export function telemetryKeysCompiledIn(config: FrontendTelemetryConfig = resolveFrontendTelemetryConfig()): boolean {
  return Boolean(config.sentryDsn || config.posthogKey)
}

/** The consent question is only asked when answering it could change what the app does. */
export function needsTelemetryConsent(
  consent: boolean | null,
  config: FrontendTelemetryConfig = resolveFrontendTelemetryConfig(),
): boolean {
  return consent === null && telemetryKeysCompiledIn(config)
}

/** Consent to store when no question is asked: nothing can be sent, so record "no". */
export function silentTelemetryConsent(
  consent: boolean | null,
  config: FrontendTelemetryConfig = resolveFrontendTelemetryConfig(),
): false | null {
  return consent === null && !telemetryKeysCompiledIn(config) ? false : null
}
