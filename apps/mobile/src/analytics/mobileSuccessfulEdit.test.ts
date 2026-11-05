import { expect, it, vi } from 'vitest'
import { trackSuccessfulMobileEdit } from './mobileSuccessfulEdit'

it('counts created/deleted notes only for actual writes, never titles or schema changes', () => {
  const capture = vi.fn()
  trackSuccessfulMobileEdit({ type: 'createNote', title: 'Private title' }, 0, capture)
  expect(capture).not.toHaveBeenCalled()
  trackSuccessfulMobileEdit({ type: 'createNote', title: 'Private title' }, 1, capture)
  expect(capture).toHaveBeenLastCalledWith({ name: 'note_created' })
  trackSuccessfulMobileEdit({ type: 'deleteNote', noteId: '/private/note' }, 1, capture)
  expect(capture).toHaveBeenLastCalledWith({ name: 'note_deleted' })
  expect(JSON.stringify(capture.mock.calls)).not.toContain('Private')
  expect(JSON.stringify(capture.mock.calls)).not.toContain('/private')
})

it('does not turn a successful save into a failure when telemetry is unavailable', () => {
  const capture = () => { throw new Error('unavailable') }
  expect(() => trackSuccessfulMobileEdit({ type: 'createNote', title: '' }, 1, capture)).not.toThrow()
})
