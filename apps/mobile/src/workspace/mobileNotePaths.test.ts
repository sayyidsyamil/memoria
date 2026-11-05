import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import {
  mobileFilenameStemForTitle,
  movedMobileNoteFilePath,
  renamedMobileNoteFilePath,
  uniqueMobileNotePath,
  validateMobileMoveNoteFolderPath,
  validateMobileRenameNoteFilePath,
} from './mobileNotePaths'

describe('mobile note paths', () => {
  it('deduplicates note paths case-insensitively for cross-platform vaults', () => {
    const base = workspaceScenarioForId('default')
    const notes = [
      { ...base.notes[0], id: 'Writing/Launch/launch-checklist.md', path: 'Writing/Launch/Launch-Checklist.md' },
      { ...base.notes[1], id: 'Writing/Launch/launch-checklist-2.md', path: 'Writing/Launch/launch-checklist-2.md' },
    ]

    expect(uniqueMobileNotePath(notes, 'Writing/Launch/launch-checklist.md')).toBe('Writing/Launch/launch-checklist-3.md')
  })

  it('validates explicit filename renames like the desktop command', () => {
    const base = workspaceScenarioForId('default')
    const selectedNote = base.notes[0]
    const notes = [
      selectedNote,
      {
        ...base.notes[1],
        id: 'Memoria/Mobile UI/manual-name.md',
        path: 'Memoria/Mobile UI/manual-name.md',
      },
    ]

    expect(renamedMobileNoteFilePath(selectedNote, 'Manual Name.md')).toBe('Memoria/Mobile UI/Manual Name.md')
    expect(validateMobileRenameNoteFilePath({ filenameStem: 'manual-name', note: selectedNote, notes })).toBe('collision')
    expect(validateMobileRenameNoteFilePath({ filenameStem: 'quarterly:plan', note: selectedNote, notes })).toBe('invalid')
    expect(validateMobileRenameNoteFilePath({ filenameStem: 'Workflow Orchestration Essay', note: selectedNote, notes })).toBe('same')
    expect(validateMobileRenameNoteFilePath({ filenameStem: 'workflow-cleanup', note: selectedNote, notes })).toBe('ok')
  })

  it('derives desktop-style filename stems from titles for rename-to-title actions', () => {
    expect(mobileFilenameStemForTitle('Weekly Review')).toBe('weekly-review')
    expect(mobileFilenameStemForTitle('My Note 你好')).toBe('my-note-你好')
    expect(mobileFilenameStemForTitle('+++')).toBe('untitled')
  })

  it('validates move destinations against existing note and explicit folder paths', () => {
    const base = workspaceScenarioForId('default')
    const selectedNote = base.notes[0]
    const notes = [
      selectedNote,
      {
        ...base.notes[1],
        id: 'Writing/Essays/Workflow Orchestration Essay.md',
        path: 'Writing/Essays/Workflow Orchestration Essay.md',
      },
    ]

    expect(movedMobileNoteFilePath(selectedNote, 'Writing/Essays')).toBe('Writing/Essays/Workflow Orchestration Essay.md')
    expect(validateMobileMoveNoteFolderPath({ folderPath: 'Writing/Essays', note: selectedNote, notes })).toBe('collision')
    expect(validateMobileMoveNoteFolderPath({ folderPath: 'Memoria/Mobile UI', note: selectedNote, notes })).toBe('same')
    expect(validateMobileMoveNoteFolderPath({ folderPath: 'Empty Folder', folderPaths: ['Empty Folder'], note: selectedNote, notes })).toBe('ok')
    expect(validateMobileMoveNoteFolderPath({ folderPath: 'Missing Folder', note: selectedNote, notes })).toBe('missingFolder')
  })
})
