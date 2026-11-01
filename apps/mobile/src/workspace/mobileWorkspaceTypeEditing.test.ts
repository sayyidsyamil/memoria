import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { applyMobileWorkspaceEditWithWrites } from './mobileWorkspaceEditing'
import type { MobileNote, MobileWorkspaceSnapshot } from './mobileWorkspaceModel'

describe('mobile Type document editing', () => {
  it.each([
    {
      expectedPath: 'note.md',
      expectedTypeName: 'Note',
      requestedTypeName: 'notes',
    },
    {
      expectedPath: 'person.md',
      expectedTypeName: 'Person',
      requestedTypeName: 'person',
    },
  ])('creates $expectedTypeName Type documents from desktop naming rules', ({
    expectedPath,
    expectedTypeName,
    requestedTypeName,
  }) => {
    const result = applyMobileWorkspaceEditWithWrites(workspaceScenarioForId('default'), {
      type: 'createTypeDefinition',
      typeName: requestedTypeName,
    })

    expect(result.snapshot.typeDefinitions?.[expectedTypeName]).toMatchObject({
      path: expectedPath,
      rawContent: expect.stringContaining(`# ${expectedTypeName}`),
    })
    expect(result.snapshot.typeDefinitions?.[requestedTypeName]).toBeUndefined()
    expect(result.writes).toEqual([{
      content: expect.stringContaining(`# ${expectedTypeName}`),
      kind: 'createNote',
      path: expectedPath,
    }])
  })

  it('does not create duplicate Type documents for slug-equivalent names', () => {
    const result = applyMobileWorkspaceEditWithWrites(workspaceScenarioForId('default'), {
      type: 'createTypeDefinition',
      typeName: 'procedure',
    })

    expect(result.snapshot.typeDefinitions?.Procedure).toBeDefined()
    expect(result.snapshot.typeDefinitions?.procedure).toBeUndefined()
    expect(result.writes).toEqual([])
  })

  it.each([
    {
      existingPath: 'briefing.md',
      existingTitle: 'Briefing',
      rejectedTypeName: 'Briefing',
      requestedTypeName: 'Briefing',
    },
    {
      existingPath: 'note.md',
      existingTitle: 'Existing Note',
      rejectedTypeName: 'Note',
      requestedTypeName: 'notes',
    },
  ])(
    'does not create $rejectedTypeName Type document when $existingPath already exists',
    ({ existingPath, existingTitle, rejectedTypeName, requestedTypeName }) => {
      const snapshot = snapshotWithOrdinaryNote(existingPath, existingTitle)

      const result = applyMobileWorkspaceEditWithWrites(snapshot, {
        type: 'createTypeDefinition',
        typeName: requestedTypeName,
      })

      expect(result.snapshot).toBe(snapshot)
      expect(result.snapshot.typeDefinitions?.[rejectedTypeName]).toBeUndefined()
      expect(result.writes).toEqual([])
    },
  )

  it('creates the built-in Note Type when notes.md is an ordinary note but note.md is free', () => {
    const snapshot = snapshotWithOrdinaryNote('notes.md', 'Meeting Notes')

    const result = applyMobileWorkspaceEditWithWrites(snapshot, {
      type: 'createTypeDefinition',
      typeName: 'notes',
    })

    expect(result.snapshot.typeDefinitions?.Note).toMatchObject({
      path: 'note.md',
      rawContent: expect.stringContaining('# Note'),
    })
    expect(result.writes).toEqual([{
      content: expect.stringContaining('# Note'),
      kind: 'createNote',
      path: 'note.md',
    }])
  })

  it('renames Type documents and rewrites assigned notes like desktop', () => {
    const result = applyMobileWorkspaceEditWithWrites(typeRenameSnapshot(), {
      nextTypeName: 'Playbook',
      type: 'renameTypeDefinition',
      typeName: 'Procedure',
    })

    expect(result.snapshot.typeDefinitions?.Procedure).toBeUndefined()
    expect(result.snapshot.typeDefinitions?.Playbook).toMatchObject({
      label: null,
      path: 'playbook.md',
      tone: 'purple',
    })
    expect(result.snapshot.typeDefinitions?.Playbook?.rawContent).toContain('# Playbook')
    expect(result.snapshot.typeDefinitions?.Playbook?.rawContent).not.toContain('_sidebar_label')
    expect(noteById(result.snapshot, 'playbook.md')).toMatchObject({
      path: 'playbook.md',
      title: 'Playbook',
      type: 'Type',
    })
    expect(noteById(result.snapshot, 'open-source-project')).toMatchObject({
      type: 'Playbook',
      typeTone: 'purple',
    })
    expect(noteById(result.snapshot, 'open-source-project').rawContent).toContain('type: Playbook')
    expect(noteById(result.snapshot, 'metadata-only-procedure')).toMatchObject({
      rawContent: undefined,
      type: 'Playbook',
    })
    expect(result.writes).toEqual([
      { kind: 'moveNote', path: 'procedure.md', toPath: 'playbook.md' },
      {
        content: expect.stringContaining('# Playbook'),
        kind: 'saveNote',
        path: 'playbook.md',
      },
      {
        content: expect.stringContaining('type: Playbook'),
        kind: 'saveNote',
        path: 'Memoria/Mobile UI/How I Run an Open Source Project.md',
      },
    ])
  })

  it('retargets Type document wikilinks and Type schema relationships when renamed', () => {
    const result = applyMobileWorkspaceEditWithWrites(typeRenamePathRewriteSnapshot(), {
      nextTypeName: 'Playbook',
      type: 'renameTypeDefinition',
      typeName: 'Procedure',
    })

    expect(noteById(result.snapshot, 'procedure-reference').rawContent).toContain('[[playbook]]')
    expect(noteById(result.snapshot, 'procedure-reference').rawContent).toContain('[[playbook|Procedure alias]]')
    expect(result.snapshot.typeDefinitions?.Release?.relationships?.related_to).toEqual(['[[playbook]]'])
    expect(result.snapshot.typeDefinitions?.Release?.rawContent).toContain('[[playbook]]')
    expect(result.writes).toEqual([
      { kind: 'moveNote', path: 'procedure.md', toPath: 'playbook.md' },
      {
        content: expect.stringContaining('# Playbook'),
        kind: 'saveNote',
        path: 'playbook.md',
      },
      {
        content: expect.stringContaining('type: Playbook'),
        kind: 'saveNote',
        path: 'Memoria/Mobile UI/How I Run an Open Source Project.md',
      },
      {
        content: expect.stringContaining('[[playbook]]'),
        kind: 'saveNote',
        path: 'procedure-reference.md',
      },
      {
        content: expect.stringContaining('[[playbook]]'),
        kind: 'saveNote',
        path: 'release.md',
      },
    ])
  })

  it('keeps visible assigned-note writes when large-vault allNotes are metadata-only', () => {
    const result = applyMobileWorkspaceEditWithWrites(typeRenameMetadataOnlyAllNotesSnapshot(), {
      nextTypeName: 'Playbook',
      type: 'renameTypeDefinition',
      typeName: 'Procedure',
    })

    expect(noteById(result.snapshot, 'open-source-project').rawContent).toContain('type: Playbook')
    expect(result.writes).toContainEqual({
      content: expect.stringContaining('type: Playbook'),
      kind: 'saveNote',
      path: 'Memoria/Mobile UI/How I Run an Open Source Project.md',
    })
  })

  it('does not rename a Type over an existing slug-equivalent Type', () => {
    const result = applyMobileWorkspaceEditWithWrites(typeRenameSnapshot(), {
      nextTypeName: 'essay',
      type: 'renameTypeDefinition',
      typeName: 'Procedure',
    })

    expect(result.snapshot.typeDefinitions?.Procedure).toBeDefined()
    expect(result.snapshot.typeDefinitions?.Essay).toBeDefined()
    expect(result.snapshot.typeDefinitions?.essay).toBeUndefined()
    expect(result.writes).toEqual([])
  })

  it('does not rename a Type document over an existing ordinary note path', () => {
    const snapshot = typeRenamePathCollisionSnapshot()

    const result = applyMobileWorkspaceEditWithWrites(snapshot, {
      nextTypeName: 'Playbook',
      type: 'renameTypeDefinition',
      typeName: 'Procedure',
    })

    expect(result.snapshot).toBe(snapshot)
    expect(result.snapshot.typeDefinitions?.Procedure).toBeDefined()
    expect(result.snapshot.typeDefinitions?.Playbook).toBeUndefined()
    expect(result.writes).toEqual([])
  })
})

function typeRenameSnapshot(): MobileWorkspaceSnapshot {
  const base = workspaceScenarioForId('default')
  const procedureDefinition = base.typeDefinitions?.Procedure
  const typeDocument = {
    ...base.notes[0],
    id: 'procedure.md',
    path: 'procedure.md',
    rawContent: procedureDefinition?.rawContent,
    title: 'Procedure',
    type: 'Type',
    typeTone: 'purple' as const,
  }
  const editableProcedure = {
    ...noteById(base, 'open-source-project'),
    rawContent: '---\ntype: Procedure\nStatus: Active\n---\n# How I Run an Open Source Project\n\nBody.\n',
  }
  const metadataOnlyProcedure = {
    ...base.notes[2],
    id: 'metadata-only-procedure',
    path: 'metadata-only-procedure.md',
    title: 'Metadata Only Procedure',
    type: 'Procedure',
    typeTone: 'purple' as const,
    rawContent: undefined,
  }
  const notes = [typeDocument, editableProcedure, metadataOnlyProcedure]

  return {
    ...base,
    allNotes: notes,
    notes,
    selectedNoteId: editableProcedure.id,
    typeDefinitions: {
      ...base.typeDefinitions,
      Procedure: {
        ...procedureDefinition,
        label: 'Procedures',
        rawContent: '---\ntype: Type\n_sidebar_label: Procedures\ncolor: purple\nicon: stack\n---\n# Procedure\n',
      },
    },
  }
}

function typeRenamePathRewriteSnapshot(): MobileWorkspaceSnapshot {
  const snapshot = typeRenameSnapshot()
  const referencingNote = {
    ...snapshot.notes[1],
    id: 'procedure-reference',
    path: 'procedure-reference.md',
    rawContent: '---\ntype: Essay\n---\n# Procedure Reference\n\nSee [[Procedure]] and [[procedure.md|Procedure alias]].\n',
    title: 'Procedure Reference',
    type: 'Essay',
    typeTone: 'green' as const,
  }

  return {
    ...snapshot,
    allNotes: [...snapshot.allNotes ?? snapshot.notes, referencingNote],
    notes: [...snapshot.notes, referencingNote],
    typeDefinitions: {
      ...snapshot.typeDefinitions,
      Release: {
        ...snapshot.typeDefinitions?.Release,
        rawContent: '---\ntype: Type\ncolor: orange\nrelated_to:\n  - "[[Procedure]]"\n---\n# Release\n',
        relationships: { related_to: ['[[Procedure]]'] },
      },
    },
  }
}

function typeRenameMetadataOnlyAllNotesSnapshot(): MobileWorkspaceSnapshot {
  const snapshot = typeRenamePathRewriteSnapshot()

  return {
    ...snapshot,
    allNotes: (snapshot.allNotes ?? snapshot.notes).map((note) => ({
      ...note,
      editorBlocks: undefined,
      editorBullets: undefined,
      rawContent: undefined,
    })),
  }
}

function typeRenamePathCollisionSnapshot(): MobileWorkspaceSnapshot {
  const snapshot = typeRenameSnapshot()
  const ordinaryNote: MobileNote = {
    ...snapshot.notes[1],
    id: 'playbook.md',
    path: 'playbook.md',
    rawContent: '---\ntype: Note\n---\n# Existing Playbook\n',
    title: 'Existing Playbook',
    type: 'Note',
  }

  return {
    ...snapshot,
    allNotes: [...snapshot.allNotes ?? snapshot.notes, ordinaryNote],
    notes: [...snapshot.notes, ordinaryNote],
  }
}

function snapshotWithOrdinaryNote(path: string, title: string): MobileWorkspaceSnapshot {
  const base = workspaceScenarioForId('default')
  const ordinaryNote: MobileNote = {
    ...base.notes[0],
    id: path,
    path,
    rawContent: `---\ntype: Note\n---\n# ${title}\n`,
    title,
    type: 'Note',
  }

  return {
    ...base,
    allNotes: [ordinaryNote],
    notes: [ordinaryNote],
    selectedNoteId: ordinaryNote.id,
    typeDefinitions: {},
  }
}

function noteById(snapshot: MobileWorkspaceSnapshot, noteId: string): MobileNote {
  const note = (snapshot.allNotes ?? snapshot.notes).find((candidate) => candidate.id === noteId)
  if (!note) throw new Error(`Expected note ${noteId}`)
  return note
}
