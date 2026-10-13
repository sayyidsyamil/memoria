import type { LedgerRegistry, LedgerValue, RegistryAttribute } from './ledgerApi'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ATTRIBUTE_LABELS: Record<string, string> = {
  outcome: 'Choice',
  amount: 'Amount',
  date: 'Date',
  deadline: 'Due date',
  due: 'Due date',
  owner: 'Owner',
  status: 'Status',
}
const CHANGE_LABELS: Record<string, string> = {
  INITIAL: 'First recorded',
  CONFIRM: 'Confirmed again',
  REVISE: 'Changed',
  REVERSE: 'Reversed',
  CORRECT: 'Corrected by you',
}

export function attributeLabel(name: string): string {
  const known = ATTRIBUTE_LABELS[name]
  if (known) return known
  const spaced = name.replace(/[_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function changeLabel(changeType: string): string {
  return CHANGE_LABELS[changeType] ?? 'Updated'
}

/** Dates are shown as written in the meeting (UTC), never shifted by the viewer's timezone. */
export function formatDate(iso: string | null | undefined): string {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null
  if (!match) return ''
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`
}

export function formatTime(iso: string | null | undefined): string {
  const match = iso ? /T(\d{2}):(\d{2})/.exec(iso) : null
  return match && !(match[1] === '00' && match[2] === '00') ? `${match[1]}:${match[2]}` : ''
}

export function formatDateTime(iso: string | null | undefined): string {
  return [formatDate(iso), formatTime(iso)].filter(Boolean).join(', ')
}

export function findAttribute(registry: LedgerRegistry | null, objectId: string, attribute: string): RegistryAttribute | undefined {
  return registry?.objects.find((o) => o.object_id === objectId)?.attributes.find((a) => a.name === attribute)
}

export function formatValue(value: LedgerValue, spec: RegistryAttribute | undefined, people: Record<string, string> = {}): string {
  if (value === null || value === undefined || value === '') return 'Not set'
  const text = String(value)
  if (spec?.type === 'person') return people[text] ?? text
  if (spec?.type === 'date' || (!spec && /^\d{4}-\d{2}-\d{2}$/.test(text))) return formatDate(text) || text
  if (typeof value === 'number') return value.toLocaleString('en-US')
  return text
}

export function slugify(name: string): string {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/** "meetings/Kick-off.md" -> "Kick-off" when the note is not known. */
export function prettyMeetingId(meetingId: string): string {
  const last = meetingId.split('/').pop() ?? meetingId
  return last.replace(/\.md$/i, '').replace(/[_]+/g, ' ')
}

/** The engine reports the review policy name; show it as a plain sentence. */
export function proposalReasonText(reason: string | null | undefined): string {
  if (!reason) return 'Waiting for your decision.'
  if (reason === 'confirm_conflicts') return 'This differs from what is already recorded, so it needs your decision.'
  if (reason === 'confirm_all') return 'Every suggestion needs your decision.'
  if (/^threshold/.test(reason)) return 'Memoria was not confident enough to record this on its own.'
  if (/^[a-z_:0-9.]+$/i.test(reason)) return 'Waiting for your decision.'
  return reason.charAt(0).toUpperCase() + reason.slice(1)
}
