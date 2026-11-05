import { describe, expect, it } from 'vitest'
import { createWorkspaceNoteInFolderEdit } from './tabletWorkspaceCreateActions'
import {
  createFolderEditFromForm,
  deleteFolderEdit,
  renameFolderEditFromForm,
} from './tabletWorkspaceFolderEditActions'

describe('tablet workspace folder edit actions', () => {
  it('builds desktop-compatible create and rename folder edits from action-sheet form state', () => {
    const form = {
      editingFolderPath: 'Writing/Drafts',
      folderName: 'Essays',
      folderParentPath: 'Writing',
    }

    expect(createFolderEditFromForm(form)).toEqual({
      name: 'Essays',
      parentPath: 'Writing',
      type: 'createFolder',
    })
    expect(renameFolderEditFromForm(form)).toEqual({
      folderPath: 'Writing/Drafts',
      name: 'Essays',
      type: 'renameFolder',
    })
  })

  it('builds delete folder edits only for selected vault-relative folder paths', () => {
    expect(deleteFolderEdit('Memoria/Mobile UI')).toEqual({
      folderPath: 'Memoria/Mobile UI',
      type: 'deleteFolder',
    })
    expect(deleteFolderEdit('')).toBeNull()
  })

  it('creates folder notes directly without opening a title form', () => {
    expect(createWorkspaceNoteInFolderEdit('Memoria/Mobile UI')).toEqual({
      defaults: { folderPath: 'Memoria/Mobile UI' },
      title: '',
      type: 'createNote',
    })
  })
})
