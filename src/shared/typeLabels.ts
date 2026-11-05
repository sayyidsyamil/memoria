const PLURAL_OVERRIDES = new Map([
  ['Person', 'People'],
  ['Responsibility', 'Responsibilities'],
])

export function pluralizeType(type: string): string {
  const override = PLURAL_OVERRIDES.get(type)
  if (override) return override
  if (type.endsWith('s') || type.endsWith('x') || type.endsWith('ch') || type.endsWith('sh')) return `${type}es`
  if (type.endsWith('y') && !/[aeiou]y$/i.test(type)) return `${type.slice(0, -1)}ies`
  return `${type}s`
}
