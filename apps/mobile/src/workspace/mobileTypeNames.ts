const defaultTypeCanonicalCase = new Map([
  ['event', 'Event'],
  ['person', 'Person'],
  ['project', 'Project'],
  ['note', 'Note'],
])
const pluralTypeSuffixes = ['ses', 'xes', 'ches', 'shes']

export function mobileTypeNameFromSidebarLabel(
  label: string,
  typeName?: string,
): string | null {
  return canonicalizeMobileTypeName(typeName ?? singularMobileTypeLabel(label))
}

function singularMobileTypeLabel(label: string): string {
  const trimmedLabel = label.trim()
  if (trimmedLabel === 'People') return 'Person'
  if (trimmedLabel.endsWith('ies')) return `${trimmedLabel.slice(0, -3)}y`
  if (pluralTypeSuffixes.some((suffix) => trimmedLabel.endsWith(suffix))) {
    return trimmedLabel.slice(0, -2)
  }
  return trimmedLabel.replace(/s$/u, '')
}

function canonicalizeMobileTypeName(type: string): string | null {
  const trimmedType = type.trim()
  if (!trimmedType) return null
  return defaultTypeCanonicalCase.get(trimmedType.toLowerCase()) ?? trimmedType
}
