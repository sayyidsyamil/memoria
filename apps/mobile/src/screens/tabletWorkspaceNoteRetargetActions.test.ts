import { describe, expect, it } from 'vitest'
import { requiredFixture } from '../fixtures/requiredFixture'
import { workspaceScenarios } from '../fixtures/workspaceFixtures'
import {
  changeNoteTypeEditFromForm,
  moveNoteToFolderEditFromForm,
  renameNoteFileEditFromForm,
  renameNoteFileToTitleEdit,
} from './tabletWorkspaceNoteRetargetActions'

describe('tablet workspace note retarget actions', () => {
  it('builds desktop-compatible selected-note retarget edits from action-sheet form state', () => {
    const form = {
      filenameStem: ' new-file-name ',
      folderPath: ' Writing/Essays ',
      noteType: ' Procedure ',
    }

    expect(changeNoteTypeEditFromForm(form, ' workflow-orchestration ')).toEqual({
      noteId: 'workflow-orchestration',
      type: 'changeNoteType',
      value: 'Procedure',
    })
    expect(moveNoteToFolderEditFromForm(form, 'workflow-orchestration')).toEqual({
      folderPath: 'Writing/Essays',
      noteId: 'workflow-orchestration',
      type: 'moveNoteToFolder',
    })
    expect(renameNoteFileEditFromForm(form, 'workflow-orchestration')).toEqual({
      filenameStem: 'new-file-name',
      noteId: 'workflow-orchestration',
      type: 'renameNoteFile',
    })
  })

  it('rejects blank selected-note retarget edits', () => {
    const form = {
      filenameStem: 'new-file-name',
      folderPath: 'Writing/Essays',
      noteType: 'Procedure',
    }

    expect(changeNoteTypeEditFromForm({ ...form, noteType: ' ' }, 'workflow-orchestration')).toBeNull()
    expect(moveNoteToFolderEditFromForm({ ...form, folderPath: ' ' }, 'workflow-orchestration')).toBeNull()
    expect(renameNoteFileEditFromForm({ ...form, filenameStem: ' ' }, 'workflow-orchestration')).toBeNull()
    expect(changeNoteTypeEditFromForm(form, ' ')).toBeNull()
  })

  it('renames the selected note file to the desktop title slug', () => {
    const selectedNote = requiredFixture(workspaceScenarios.default.notes[0])

    expect(renameNoteFileToTitleEdit(selectedNote)).toEqual({
      filenameStem: 'workflow-orchestration-essay',
      noteId: selectedNote.id,
      type: 'renameNoteFile',
    })
  })

  it('does not build a rename-to-title edit without a selected note', () => {
    expect(renameNoteFileToTitleEdit(null)).toBeNull()
  })

  it('renames blank titles to the desktop untitled filename fallback', () => {
    const selectedNote = {
      ...requiredFixture(workspaceScenarios.default.notes[0]),
      title: '   ',
    }

    expect(renameNoteFileToTitleEdit(selectedNote)).toEqual({
      filenameStem: 'untitled',
      noteId: selectedNote.id,
      type: 'renameNoteFile',
    })
  })
})
