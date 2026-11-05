export const SUGGESTED_PROPERTY_SLOTS = [
  { key: 'Status', label: 'Status' },
  { key: 'Date', label: 'Date' },
  { key: 'URL', label: 'URL' },
  { key: 'icon', label: 'Icon' },
] as const

export const SUGGESTED_PROPERTY_KEYS = SUGGESTED_PROPERTY_SLOTS.map((slot) => slot.key)

export const SUGGESTED_RELATIONSHIP_KEYS = ['belongs_to', 'related_to', 'has'] as const

export const SAVED_VIEW_BUILT_IN_FIELDS = [
  'type',
  'status',
  'title',
  'favorite',
  'body',
  'filename',
  'archived',
  'tags',
] as const
