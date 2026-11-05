export function normalizedOptionalSort(sort: string) {
  return sort.trim() || null
}

export function normalizedOptionalIcon(icon: string): string | null {
  return icon.trim() || null
}
