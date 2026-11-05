import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { meetingService } from '../meetings/meetingService'
import type { MeetingRecord } from '../meetings/meetingTypes'
import { useMeetingTitles } from './useMeetingTitles'

vi.mock('../meetings/meetingService', () => ({ meetingService: { list: vi.fn() } }))

const record = (id: string, title: string): MeetingRecord => ({ id, title, status: 'needs-review', pagePath: `meetings/${id}.md` })
const list = vi.mocked(meetingService.list)
beforeEach(() => { list.mockReset() })

it('looks titles up in the meeting list of the vault', async () => {
  list.mockResolvedValue([record('one', ' Pilot review '), record('two', '   '), record('three', 'Budget workshop')])
  const { result } = renderHook(() => useMeetingTitles('/vault'))
  expect(result.current.titles.size).toBe(0)
  await waitFor(() => expect(result.current.titles.size).toBe(2))
  expect([...result.current.titles]).toEqual([['one', 'Pilot review'], ['three', 'Budget workshop']])
  expect(list).toHaveBeenCalledWith('/vault')
})

it('knows when each meeting took place, for ordering what it suggested', async () => {
  list.mockResolvedValue([{ ...record('one', 'Kick-off'), created: '2026-09-14T01:30:00Z' }, record('two', 'Undated')])
  const { result } = renderHook(() => useMeetingTitles('/vault'))
  await waitFor(() => expect(result.current.dates.size).toBe(1))
  expect(result.current.dates.get('one')).toBe('2026-09-14T01:30:00Z')
})

it.each([
  ['rejects', () => list.mockRejectedValue(new Error('The meeting runtime is unavailable'))],
  ['throws at once', () => list.mockImplementation(() => { throw new Error('Not available') })],
  ['returns something unexpected', () => list.mockResolvedValue({ meetings: [] } as unknown as MeetingRecord[])],
])('quietly keeps no titles when the meeting service %s', async (_name, arrange) => {
  arrange()
  const { result } = renderHook(() => useMeetingTitles('/vault'))
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
  await act(async () => { await Promise.resolve() })
  expect(result.current.titles.size).toBe(0)
})

it('reloads on request, keeping the known titles if the reload fails', async () => {
  list.mockResolvedValueOnce([record('one', 'Pilot review')])
  const { result } = renderHook(() => useMeetingTitles('/vault'))
  await waitFor(() => expect(result.current.titles.get('one')).toBe('Pilot review'))
  list.mockRejectedValueOnce(new Error('Temporarily unavailable'))
  act(() => result.current.reload())
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  await act(async () => { await Promise.resolve() })
  expect(result.current.titles.get('one')).toBe('Pilot review')
  list.mockResolvedValueOnce([record('one', 'Pilot review, renamed')])
  act(() => result.current.reload())
  await waitFor(() => expect(result.current.titles.get('one')).toBe('Pilot review, renamed'))
})

it('never shows or accepts titles from another vault', async () => {
  let finishOld!: (records: MeetingRecord[]) => void
  list.mockImplementation(vault => vault === '/old' ? new Promise(resolve => { finishOld = resolve }) : Promise.resolve([record('new', 'New title')]))
  const { result, rerender } = renderHook(({ vault }) => useMeetingTitles(vault), { initialProps: { vault: '/old' } })
  await waitFor(() => expect(list).toHaveBeenCalledWith('/old'))
  rerender({ vault: '/new' })
  await waitFor(() => expect(result.current.titles.get('new')).toBe('New title'))
  await act(async () => finishOld([record('old', 'Old title')]))
  expect(result.current.titles.has('old')).toBe(false)
  expect(result.current.titles.get('new')).toBe('New title')
  // Going back: the answer for /new must not be offered for /old while /old loads again.
  list.mockImplementation(() => new Promise(() => undefined))
  rerender({ vault: '/old' })
  expect(result.current.titles.size).toBe(0)
})
