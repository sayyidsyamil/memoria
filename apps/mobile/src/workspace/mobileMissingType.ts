import type { MobileNote, MobileTypeDefinitions } from './mobileWorkspaceModel'

export function resolveMobileMissingTypeName(
  note: Pick<MobileNote, 'type'>,
  typeDefinitions: MobileTypeDefinitions | undefined,
): string | null {
  const typeName = note.type.trim()
  if (!typeName) return null

  return typeDefinitions?.[typeName] ? null : typeName
}
