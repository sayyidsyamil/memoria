import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { applyMobileWorkspaceEditWithWrites } from './mobileWorkspaceEditing'
import type { MobileNote, MobileWorkspaceSnapshot } from './mobileWorkspaceModel'

describe('mobile text file editing', () => {
  it('hydrates text files as raw content without markdown derivation', () => {
    const textFile = textFileNote({ rawContent: undefined })
    const snapshot = snapshotWithTextFile(textFile)
    const rawContent = 'title: Should Not Become Title\n# Markdown-looking Title\nplain: true\n'

    const result = applyMobileWorkspaceEditWithWrites(snapshot, {
      noteId: textFile.id,
      rawContent,
      type: 'hydrateTextFileContent',
    })
    const hydrated = result.snapshot.allNotes?.find((note) => note.id === textFile.id)

    expect(result.writes).toEqual([])
    expect(hydrated).toMatchObject({
      editorBlocks: undefined,
      fileKind: 'text',
      rawContent,
      relationships: [],
      snippet: 'title: Should Not Become Title',
      tags: [],
      title: 'config.yml',
      type: 'File',
    })
  })

  it('saves text file edits as raw text without creating note metadata', () => {
    const textFile = textFileNote({ rawContent: 'plain=true\n' })
    const snapshot = snapshotWithTextFile(textFile)
    const content = '---\ntype: Essay\n---\n# Still plain text\n'

    const result = applyMobileWorkspaceEditWithWrites(snapshot, {
      content,
      noteId: textFile.id,
      type: 'updateTextFileContent',
    })
    const updated = result.snapshot.allNotes?.find((note) => note.id === textFile.id)

    expect(updated).toMatchObject({
      editorBlocks: undefined,
      fileKind: 'text',
      rawContent: content,
      title: 'config.yml',
      type: 'File',
    })
    expect(result.writes).toEqual([{
      content,
      kind: 'saveNote',
      path: 'docs/config.yml',
    }])
  })
})

function textFileNote(overrides: Partial<MobileNote> = {}): MobileNote {
  const base = workspaceScenarioForId('default').notes[0]

  return {
    ...base,
    aliases: [],
    editorBlocks: undefined,
    editorBullets: undefined,
    favorite: false,
    favoriteIndex: null,
    fileKind: 'text',
    id: 'docs/config.yml',
    links: 0,
    noteWidth: null,
    organized: false,
    outgoingLinks: [],
    path: 'docs/config.yml',
    properties: [],
    rawContent: undefined,
    relationships: [],
    snippet: 'stale metadata',
    status: '',
    tags: [],
    title: 'config.yml',
    type: 'File',
    typeTone: 'gray',
    ...overrides,
  }
}

function snapshotWithTextFile(note: MobileNote): MobileWorkspaceSnapshot {
  const base = workspaceScenarioForId('default')
  return {
    ...base,
    allNotes: [note],
    notes: [note],
    selectedNoteId: note.id,
  }
}
