const formatter = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' })
const dates = new Map<string, string>()

export function relativeDate(timestamp: number | null | undefined): string {
  if (!timestamp) return '-'
  const elapsedMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`
  const elapsedHours = Math.round(elapsedMinutes / 60)
  if (elapsedHours < 48) return `${elapsedHours}h ago`
  return `${Math.round(elapsedHours / 24)}d ago`
}

export function absoluteDate(timestamp: number | null | undefined): string {
  if (!timestamp) return '-'
  const date = new Date(timestamp)
  const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
  const cached = dates.get(key)
  if (cached) return cached
  const formatted = formatter.format(date)
  dates.set(key, formatted)
  return formatted
}

export function noteListSubtitle(visibleCount: number, totalCount: number): string {
  if (visibleCount === totalCount) return totalCount.toLocaleString()
  return `${visibleCount.toLocaleString()} / ${totalCount.toLocaleString()}`
}
