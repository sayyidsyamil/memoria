import { relationshipFrontmatterKey } from '../../../../src/utils/relationshipKeys'
import type { MobileNote, MobileRelationshipValue } from './mobileWorkspaceModel'

type EditableMobileNote = MobileNote & { rawContent: string }
type WikilinkRef = string

export function preservedMobileSourceFrontmatterMetadata(note: EditableMobileNote) {
  return {
    note,
    rawRelationships: mobileRawRelationshipsFromNote(note),
  }
}

function mobileRawRelationshipsFromNote(note: MobileNote): Record<string, WikilinkRef[]> {
  return Object.fromEntries(
    note.relationships.map((relationship) => [
      relationshipFrontmatterKey(relationship),
      relationship.values.map(mobileRelationshipRefValue),
    ]),
  )
}

export function mobileRelationshipRefValue(value: MobileRelationshipValue): WikilinkRef {
  return value.ref ?? `[[${value.title}]]`
}
