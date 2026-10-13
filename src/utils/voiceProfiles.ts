import type { Settings } from '../types'

export const VOICE_CONSENT_QUESTION = 'Save voice profiles on this computer only? You can delete them any time.'

/** Voice profiles are biometric data, so only an explicit "yes" turns them on. */
export function rememberVoicesEnabled(settings: Pick<Settings, 'remember_voices'>): boolean {
  return settings.remember_voices === true
}

/** The question is asked once: when the user names a speaker and has never answered. */
export function shouldAskVoiceConsent(
  settings: Pick<Settings, 'remember_voices'>,
  labels: Record<string, string>,
  speakers: string[],
): boolean {
  if (settings.remember_voices === true || settings.remember_voices === false) return false
  return speakers.some((speaker) => {
    const name = labels[speaker]?.trim()
    return Boolean(name) && name !== speaker
  })
}

/** Names that may be saved as voice profiles; empty unless the user opted in. */
export function voiceProfileLabels(
  enabled: boolean,
  labels: Record<string, string>,
  speakers: string[],
): Record<string, string> {
  if (!enabled) return {}
  const result: Record<string, string> = {}
  for (const speaker of speakers) {
    const name = labels[speaker]?.trim()
    if (name && name !== speaker) result[speaker] = name
  }
  return result
}
