import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { meetingService } from './meetingService'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
beforeEach(() => vi.mocked(invoke).mockReset())
const fixture = { id: 'one', title: 'Pilot', status: 'needs-review', pagePath: 'meetings/one.md' }

it('uses the explicit meeting API and validates list records', async () => {
  vi.mocked(invoke).mockResolvedValue([fixture])
  expect(await meetingService.list('/vault')).toEqual([fixture])
  expect(invoke).toHaveBeenCalledWith('meetings_api', { request: { vaultPath: '/vault', operation: 'list' } })
  vi.mocked(invoke).mockResolvedValue([{ id: 'broken' }])
  await expect(meetingService.list('/vault')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})
it('preserves typed backend errors and rejects unconfirmed deletion', async () => {
  vi.mocked(invoke).mockRejectedValue({ code: 'MEETING_EXTERNALLY_MODIFIED', message: 'Preserve external edits.' })
  await expect(meetingService.delete('/vault', 'one')).rejects.toMatchObject({ code: 'MEETING_EXTERNALLY_MODIFIED', message: 'Preserve external edits.' })
  vi.mocked(invoke).mockResolvedValue({ deleted: true, id: 'someone-else' })
  await expect(meetingService.delete('/vault', 'one')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})
