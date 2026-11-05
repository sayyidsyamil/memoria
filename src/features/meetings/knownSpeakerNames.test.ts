import { beforeEach, expect, it, vi } from 'vitest'
import { createVaultBackend } from '../../lib/vaultBackend'
import type { VaultBackend } from '../../lib/vaultBackend'
import { loadKnownSpeakerNames, mergeNames, nameKey, withoutNames } from './knownSpeakerNames'
import { meetingService } from './meetingService'
import type { MeetingRecord } from './meetingTypes'

vi.mock('./meetingService', () => ({ meetingService: { list: vi.fn() } }))
vi.mock('../../lib/vaultBackend', () => ({ createVaultBackend: vi.fn() }))

const listMeetings = vi.mocked(meetingService.list)
const listVault = vi.fn()
const meeting = (id: string, names?: Record<string, string>): MeetingRecord => ({ id, title: id, status: 'transcript-reviewed', pagePath: `meetings/${id}.md`, names })
const note = (title: string, patch: object = {}) => ({ path: `/vault/${title}.md`, filename: `${title}.md`, title, isA: 'Person', archived: false, ...patch })

beforeEach(() => {
  listMeetings.mockReset().mockResolvedValue([])
  listVault.mockReset().mockResolvedValue([])
  vi.mocked(createVaultBackend).mockReset().mockReturnValue({ files: { list: listVault } } as unknown as VaultBackend)
})

it('treats names that differ only in case or spacing as one name', () => {
  expect(nameKey('  Alex   Tan ')).toBe('alex tan')
  expect(nameKey('ALEX TAN')).toBe(nameKey('alex tan'))
  expect(nameKey('Alex Tanner')).not.toBe(nameKey('Alex Tan'))
})

it('merges names once each, alphabetically, keeping the earliest spelling and ignoring anything that is not a name', () => {
  expect(mergeNames(['Maya Lim', 'sam ortiz'], ['  maya   lim ', 'Alex Tan', '', '   ', null, undefined, 42, { name: 'x' }], ['SAM ORTIZ', 'bea']))
    .toEqual(['Alex Tan', 'bea', 'Maya Lim', 'sam ortiz'])
  expect(mergeNames([])).toEqual([])
  expect(mergeNames()).toEqual([])
})

it('sorts the way people read a list: ignoring case, with numbers in order', () => {
  expect(mergeNames(['zoe', 'Álvaro', 'adam', 'Adam Two', 'Speaker 10', 'Speaker 2'])).toEqual(['adam', 'Adam Two', 'Álvaro', 'Speaker 2', 'Speaker 10', 'zoe'])
})

it('leaves out the names that are offered some other way', () => {
  expect(withoutNames(['Alex Tan', 'Maya Lim', 'Sam Ortiz'], ['maya  lim', 'Someone Else'])).toEqual(['Alex Tan', 'Sam Ortiz'])
  expect(withoutNames(['Alex Tan'], [])).toEqual(['Alex Tan'])
})

it('collects the names given in other meetings, never the current meeting’s own', async () => {
  listMeetings.mockResolvedValue([
    meeting('current', { S01: 'Only in this meeting' }), meeting('earlier', { S01: 'Alex Tan', S02: 'Maya Lim' }),
    meeting('oldest', { S01: 'alex tan', S02: '   ' }), meeting('unnamed'), meeting('empty', {}),
  ])
  expect(await loadKnownSpeakerNames('/vault', 'current')).toEqual(['Alex Tan', 'Maya Lim'])
  expect(listMeetings).toHaveBeenCalledWith('/vault')
  // Without a current meeting nothing is excluded.
  expect(await loadKnownSpeakerNames('/vault')).toEqual(['Alex Tan', 'Maya Lim', 'Only in this meeting'])
})

it('collects the titles of the active Person notes: the ones the sidebar counts as People', async () => {
  listVault.mockResolvedValue([
    note('Sam Ortiz'), note('Maya Lim', { aliases: ['Maya'] }), note('Old Contact', { archived: true }),
    note('Person', { isA: 'Type' }), note('Launch plan', { isA: 'Project' }), note('Loose note', { isA: null }),
    note('Scan', { fileKind: 'binary' }), note('Readme', { fileKind: 'text' }), note('Typed', { fileKind: 'markdown' }), { title: 'No path', isA: 'Person' },
  ])
  expect(await loadKnownSpeakerNames('/vault')).toEqual(['Maya Lim', 'Sam Ortiz', 'Typed'])
  expect(createVaultBackend).toHaveBeenCalledWith('/vault')
})

it('puts People first, so that a note’s spelling is the one that is kept', async () => {
  listMeetings.mockResolvedValue([meeting('earlier', { S01: 'alex tan', S02: 'Maya LIM' })])
  listVault.mockResolvedValue([note('Alex Tan'), note('Maya Lim')])
  expect(await loadKnownSpeakerNames('/vault', 'current')).toEqual(['Alex Tan', 'Maya Lim'])
})

// Each row breaks one thing; the other source (an earlier meeting naming Alex Tan, a Person note for Maya Lim) must still be read.
it.each([
  ['the meeting list rejects', () => listMeetings.mockRejectedValue(new Error('Unavailable')), ['Maya Lim']],
  ['the meeting service throws as soon as it is called', () => listMeetings.mockImplementation(() => { throw new Error('Unavailable') }), ['Maya Lim']],
  ['the meeting list is not a list', () => listMeetings.mockResolvedValue({ meetings: [] } as unknown as MeetingRecord[]), ['Maya Lim']],
  ['a record is not a record', () => listMeetings.mockResolvedValue([null, 'text', 7, { id: 'a', names: 'Alex' }, { id: 'b', names: null }, meeting('c', { S01: 'Alex Tan' })] as unknown as MeetingRecord[]), ['Alex Tan', 'Maya Lim']],
  ['the vault listing rejects', () => listVault.mockRejectedValue(new Error('Vault unavailable')), ['Alex Tan']],
  ['the vault listing is not a list', () => listVault.mockResolvedValue({ entries: [] }), ['Alex Tan']],
  ['the vault backend cannot be created', () => vi.mocked(createVaultBackend).mockImplementation(() => { throw new Error('No vault') }), ['Alex Tan']],
])('still answers when %s, with whatever the other source holds', async (_name, arrange, expected) => {
  listMeetings.mockResolvedValue([meeting('earlier', { S01: 'Alex Tan' })])
  listVault.mockResolvedValue([note('Maya Lim')])
  arrange()
  expect(await loadKnownSpeakerNames('/vault', 'current')).toEqual(expected)
})

it('answers with no names, and does not reject, when nothing can be read', async () => {
  listMeetings.mockRejectedValue(new Error('Meetings unavailable'))
  listVault.mockRejectedValue(new Error('Vault unavailable'))
  await expect(loadKnownSpeakerNames('/vault', 'current')).resolves.toEqual([])
})

it('does not wait for the meeting list before reading the vault', async () => {
  listMeetings.mockReturnValue(new Promise(() => undefined))
  void loadKnownSpeakerNames('/vault')
  await vi.waitFor(() => expect(listVault).toHaveBeenCalledTimes(1))
})
