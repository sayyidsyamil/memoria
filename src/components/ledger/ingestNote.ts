import type { IngestResult, LedgerApi } from '../../lib/ledgerApi'
import { parseTranscriptNote } from '../../lib/transcriptNote'
import type { VaultEntry } from '../../types'

const TRANSCRIPT_TYPES = new Set(['transcript', 'meeting', 'meeting minute', 'meeting minutes'])

/** A stable id for a note: its path relative to the vault root. */
export function meetingIdForNote(path: string, vaultPath: string): string {
  const root = vaultPath.replace(/\/+$/, '')
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

export function isTranscriptCandidate(entry: VaultEntry): boolean {
  if (entry.archived || !/\.md$/i.test(entry.path)) return false
  if (TRANSCRIPT_TYPES.has((entry.isA ?? '').trim().toLowerCase())) return true
  return /(^|\/)transcripts\//i.test(entry.path)
}

export function isNote(entry: VaultEntry): boolean {
  return !entry.archived && /\.md$/i.test(entry.path)
}

export class NoTranscriptError extends Error {}

export async function ingestNote(args: {
  api: LedgerApi
  entry: VaultEntry
  vaultPath: string
  readNote: (path: string) => Promise<string>
  today?: Date
}): Promise<IngestResult> {
  const { api, entry, vaultPath, readNote } = args
  const parsed = parseTranscriptNote(await readNote(entry.path))
  if (parsed.turns.length === 0) {
    throw new NoTranscriptError(`"${entry.title}" has no spoken lines in it, so there is nothing to add. A transcript has lines like **Name** · 0:12 followed by what they said.`)
  }
  const fallback = (args.today ?? new Date()).toISOString().slice(0, 19)
  return api.ingestMeeting({
    meetingId: meetingIdForNote(entry.path, vaultPath),
    turns: parsed.turns,
    occurredAt: parsed.occurredAt ?? fallback,
  })
}

export function summariseIngest(result: IngestResult): string {
  if (result.stored_only) return 'Saved the meeting. Automatic reading is switched off, so no decisions were looked for.'
  const applied = result.counts.applied ?? 0
  const proposed = result.counts.proposed ?? 0
  const skipped = (result.counts.ungrounded ?? 0) + (result.counts.invalid ?? 0) + (result.counts.unresolved ?? 0)
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const parts = [`${plural(applied, 'decision or promise', 'decisions and promises')} recorded`, `${proposed} waiting for your review`]
  if (skipped > 0) parts.push(`${plural(skipped, 'suggestion', 'suggestions')} ignored because no matching quote was found`)
  return `${parts.join(', ')}.`
}
