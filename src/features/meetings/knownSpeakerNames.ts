import { createVaultBackend } from '../../lib/vaultBackend'
import { isMarkdownEntry } from '../../utils/typeDefinitions'
import { normalizeVaultEntries } from '../../utils/vaultMetadataNormalization'
import { meetingService } from './meetingService'

/** The note type the sidebar groups under "People". */
const PERSON_TYPE = 'Person'

const alphabetical = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/** A name as people write it: inner whitespace collapsed and the ends trimmed. Anything that is not text is no name. */
function tidy(name: unknown): string {
  return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : ''
}

/** Names that differ only in case or spacing are one name. */
export function nameKey(name: string): string {
  return tidy(name).toLocaleLowerCase()
}

/** Names once each, in alphabetical order. When a name appears in several groups, the earliest group's spelling is kept. */
export function mergeNames(...groups: readonly (readonly unknown[])[]): string[] {
  const names = new Map<string, string>()
  for (const group of groups) {
    for (const candidate of group) {
      const name = tidy(candidate)
      if (name && !names.has(nameKey(name))) names.set(nameKey(name), name)
    }
  }
  return [...names.values()].sort(alphabetical.compare)
}

/** The names that are not already offered some other way, such as a remembered voice. */
export function withoutNames(names: readonly string[], offered: readonly string[]): string[] {
  const taken = new Set(offered.map(nameKey))
  return names.filter(name => !taken.has(nameKey(name)))
}

/** Names the reviewers gave speakers in the saved records of other meetings. */
async function namesInOtherMeetings(vaultPath: string, currentMeetingId?: string): Promise<unknown[]> {
  const records = await meetingService.list(vaultPath)
  return Array.isArray(records)
    ? records.flatMap(record => record && record.id !== currentMeetingId && record.names && typeof record.names === 'object' ? Object.values(record.names) : [])
    : []
}

/** Titles of the vault's active Person notes: the notes the sidebar counts as "People". */
async function peopleInVault(vaultPath: string): Promise<string[]> {
  const entries = normalizeVaultEntries(await createVaultBackend(vaultPath).files.list(), vaultPath)
  return entries.filter(entry => entry.isA === PERSON_TYPE && !entry.archived && isMarkdownEntry(entry)).map(entry => entry.title)
}

/** A source that cannot be read adds no names; it never stops the other one. */
async function quietly(read: () => Promise<readonly unknown[]>): Promise<readonly unknown[]> {
  try { return await read() } catch { return [] }
}

/**
 * Names a reviewer is likely to want for a speaker: People notes, then names given in other meetings. Sorted, once each.
 * Best effort and never rejecting, so that a vault or meeting service that cannot be read only leaves out the extra options.
 */
export async function loadKnownSpeakerNames(vaultPath: string, currentMeetingId?: string): Promise<string[]> {
  const [people, meetings] = await Promise.all([quietly(() => peopleInVault(vaultPath)), quietly(() => namesInOtherMeetings(vaultPath, currentMeetingId))])
  return mergeNames(people, meetings)
}
