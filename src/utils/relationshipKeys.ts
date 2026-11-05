export type RelationshipKind = 'belongsTo' | 'has' | 'relatedTo' | 'custom'

type RelationshipKeyCarrier = {
  key?: string | null
  kind?: RelationshipKind | null
  label?: string | null
}

const RELATIONSHIP_KEYS_BY_KIND = new Map<RelationshipKind, string>([
  ['belongsTo', 'belongs_to'],
  ['has', 'has'],
  ['relatedTo', 'related_to'],
])

export function normalizeRelationshipKey(key: string): string {
  return key.trim().toLowerCase().replace(/[-\s]+/gu, '_')
}

export function relationshipKindForKey(key: string): RelationshipKind {
  const canonical = normalizeRelationshipKey(key)
  if (canonical === 'belongs_to') return 'belongsTo'
  if (canonical === 'related_to') return 'relatedTo'
  if (canonical === 'has' || canonical.startsWith('has_')) return 'has'
  return 'custom'
}

export function isRelationshipKey(key: string): boolean {
  return relationshipKindForKey(key) !== 'custom'
}

export function relationshipKeyForKind(kind: RelationshipKind | null | undefined): string | null {
  return kind ? RELATIONSHIP_KEYS_BY_KIND.get(kind) ?? null : null
}

export function relationshipFrontmatterKey(
  relationship: RelationshipKeyCarrier,
  fallback = 'related_to',
): string {
  if (relationship.key) return relationship.key
  return relationshipKeyForKind(relationship.kind) ?? relationship.label ?? fallback
}

export function relationshipLookupKeys(relationship: RelationshipKeyCarrier): string[] {
  const explicitKeys = uniqueRelationshipKeys([
    relationship.key,
    relationship.label,
  ])
  if (explicitKeys.length > 0) return explicitKeys

  return uniqueRelationshipKeys([relationshipKeyForKind(relationship.kind)])
}

function uniqueRelationshipKeys(keys: Array<string | null | undefined>): string[] {
  return Array.from(new Set(keys
    .filter((key): key is string => Boolean(key?.trim()))
    .map(normalizeRelationshipKey)))
}
