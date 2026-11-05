import { describe, expect, it } from 'vitest'
import {
  commitMobileEditorDraft,
  createMobileEditorDraft,
  editMobileEditorDraft,
  mobileEditorDraftNeedsCommit,
  syncMobileEditorDraft,
} from './mobileEditorDraft'

describe('mobileEditorDraft', () => {
  it('tracks local edits without mutating the saved source content', () => {
    const draft = editMobileEditorDraft(
      createMobileEditorDraft('note-a.md', '# Original\n'),
      '# Original\n\nNew paragraph\n',
    )

    expect(draft).toMatchObject({
      dirty: true,
      draftContent: '# Original\n\nNew paragraph\n',
      savedContent: '# Original\n',
    })
    expect(mobileEditorDraftNeedsCommit(draft)).toBe(true)
  })

  it('marks a committed draft clean at the exact content sent to the reducer', () => {
    const dirty = editMobileEditorDraft(createMobileEditorDraft('note-a.md', 'A'), 'AB')
    const committed = commitMobileEditorDraft(dirty)

    expect(committed).toEqual({
      dirty: false,
      draftContent: 'AB',
      noteId: 'note-a.md',
      savedContent: 'AB',
    })
    expect(mobileEditorDraftNeedsCommit(committed)).toBe(false)
  })

  it('keeps unsaved local typing when the same note receives a stale source update', () => {
    const dirty = editMobileEditorDraft(createMobileEditorDraft('note-a.md', 'A'), 'AB')
    const synced = syncMobileEditorDraft(dirty, { content: 'A from disk', noteId: 'note-a.md' })

    expect(synced).toMatchObject({
      dirty: true,
      draftContent: 'AB',
      savedContent: 'A from disk',
    })
  })

  it('resets the draft when switching notes', () => {
    const dirty = editMobileEditorDraft(createMobileEditorDraft('note-a.md', 'A'), 'AB')
    const synced = syncMobileEditorDraft(dirty, { content: 'B', noteId: 'note-b.md' })

    expect(synced).toEqual(createMobileEditorDraft('note-b.md', 'B'))
  })
})
