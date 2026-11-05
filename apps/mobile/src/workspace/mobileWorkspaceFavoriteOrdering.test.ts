import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import {
  applyMobileWorkspaceEditWithWrites,
  type MobileWorkspaceWrite,
} from './mobileWorkspaceEditing'
import type { MobileNote, MobileWorkspaceSnapshot } from './mobileWorkspaceModel'

type FavoriteNoteOverrides = Pick<MobileNote, 'favoriteIndex' | 'id' | 'path' | 'title'>

describe('mobile favorite ordering', () => {
  it('toggles favorites through desktop _favorite and _favorite_index frontmatter', () => {
    const base = workspaceScenarioForId('default')
    const openSourceNote = base.notes.find((candidate) => candidate.id === 'open-source-project')
    if (!openSourceNote) throw new Error('Missing open source fixture note')
    const favoritePeer = favoriteNote(base.notes[0], {
      favoriteIndex: 7,
      id: base.notes[0].id,
      path: base.notes[0].path,
      title: 'Workflow Orchestration Essay',
    })
    const editableOpenSourceNote = {
      ...openSourceNote,
      rawContent: [
        '---',
        'title: How I Run an Open Source Project',
        'type: Procedure',
        '---',
        '# How I Run an Open Source Project',
        '',
      ].join('\n'),
    }
    const favoriteResult = applyMobileWorkspaceEditWithWrites({
      ...base,
      allNotes: [favoritePeer, editableOpenSourceNote],
      notes: [favoritePeer, editableOpenSourceNote],
    }, {
      noteId: editableOpenSourceNote.id,
      type: 'toggleFavorite',
    })
    const favorited = noteById(favoriteResult.snapshot, editableOpenSourceNote.id)

    expect(favorited).toMatchObject({ favorite: true, favoriteIndex: 8 })
    expect(favorited.rawContent).toContain('_favorite: true')
    expect(favorited.rawContent).toContain('_favorite_index: 8')
    expect(favoriteResult.writes).toEqual([{
      content: favorited.rawContent,
      kind: 'saveNote',
      path: 'Memoria/Mobile UI/How I Run an Open Source Project.md',
    }])

    const unfavoriteResult = applyMobileWorkspaceEditWithWrites(favoriteResult.snapshot, {
      noteId: editableOpenSourceNote.id,
      type: 'toggleFavorite',
    })
    const unfavorited = noteById(unfavoriteResult.snapshot, editableOpenSourceNote.id)

    expect(unfavorited).toMatchObject({ favorite: false, favoriteIndex: null })
    expect(unfavorited.rawContent).not.toContain('_favorite:')
    expect(unfavorited.rawContent).not.toContain('_favorite_index:')
  })

  it('reorders favorites by rewriting desktop favorite indices', () => {
    const base = workspaceScenarioForId('default')
    const alpha = favoriteNote(base.notes[0], {
      favoriteIndex: 7,
      id: 'alpha-favorite',
      path: 'Writing/Alpha.md',
      title: 'Alpha',
    })
    const beta = favoriteNote(base.notes[1], {
      favoriteIndex: 12,
      id: 'beta-favorite',
      path: 'Writing/Beta.md',
      title: 'Beta',
    })
    const result = applyMobileWorkspaceEditWithWrites({
      ...base,
      allNotes: [alpha, beta],
      notes: [alpha, beta],
    }, {
      direction: 'up',
      noteId: beta.id,
      type: 'moveFavorite',
    })
    const writes = result.writes.filter(isSaveNoteWrite)

    expect(noteById(result.snapshot, beta.id)).toMatchObject({ favoriteIndex: 0 })
    expect(noteById(result.snapshot, alpha.id)).toMatchObject({ favoriteIndex: 1 })
    expect(favoriteLabels(result.snapshot)).toEqual(['Beta', 'Alpha'])
    expect(writes.map((write) => write.path)).toEqual(['Writing/Beta.md', 'Writing/Alpha.md'])
    expect(writes[0]?.content).toContain('_favorite_index: 0')
    expect(writes[1]?.content).toContain('_favorite_index: 1')
  })
})

function favoriteNote(note: MobileNote, overrides: FavoriteNoteOverrides): MobileNote {
  return {
    ...note,
    ...overrides,
    archived: false,
    favorite: true,
    rawContent: [
      '---',
      `title: ${overrides.title}`,
      '_favorite: true',
      `_favorite_index: ${overrides.favoriteIndex}`,
      '---',
      `# ${overrides.title}`,
      '',
    ].join('\n'),
  }
}

function noteById(snapshot: MobileWorkspaceSnapshot, noteId: string): MobileNote {
  const note = snapshot.allNotes?.find((candidate) => candidate.id === noteId)
  if (!note) throw new Error(`Missing note ${noteId}`)
  return note
}

function favoriteLabels(snapshot: MobileWorkspaceSnapshot): string[] {
  return snapshot.sidebarSections
    .find((section) => section.id === 'favorites')
    ?.items
    ?.map((item) => item.label) ?? []
}

function isSaveNoteWrite(write: MobileWorkspaceWrite): write is Extract<MobileWorkspaceWrite, { kind: 'saveNote' }> {
  return write.kind === 'saveNote'
}
