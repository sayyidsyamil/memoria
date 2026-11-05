import type { MobileTone, MobileTypeDefinitions } from './mobileWorkspaceModel'

const typeToneFallbacks: Record<string, MobileTone> = {
  Event: 'yellow',
  Experiment: 'red',
  Person: 'yellow',
  Procedure: 'purple',
  Project: 'red',
  Responsibility: 'purple',
  Topic: 'green',
  Type: 'blue',
}

export function mobileWorkspaceTypeTone(
  type: string,
  typeDefinitions: MobileTypeDefinitions | undefined,
  fallback: MobileTone,
): MobileTone {
  return typeDefinitions?.[type]?.tone ?? typeToneFallbacks[type] ?? fallback
}
