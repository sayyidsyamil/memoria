import { describe, expect, it } from 'vitest'
import { requiredFixture } from '../fixtures/requiredFixture'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { applyMobileWorkspaceEditWithWrites } from './mobileWorkspaceEditing'
import type {
  MobileNote,
  MobileTypeDefinition,
  MobileWorkspaceSnapshot,
} from './mobileWorkspaceModel'

describe('mobile type definition path rewrites', () => {
  it('retargets Type schema relationship refs when notes move folders', () => {
    const snapshot = schemaReferenceSnapshot(['archive', 'projects'])
    const result = applyMobileWorkspaceEditWithWrites(snapshot, {
      folderPath: 'archive',
      noteId: 'projects/remote.md',
      type: 'moveNoteToFolder',
    })
    const project = result.snapshot.typeDefinitions?.Project

    expect(project?.relationships?.depends_on).toEqual(['[[team/archive/remote]]'])
    expect(project?.rawContent).toContain('[[team/archive/remote]]')
    expect(result.writes).toEqual([
      {
        kind: 'moveNote',
        path: 'projects/remote.md',
        toPath: 'archive/remote.md',
      },
      {
        content: project?.rawContent,
        kind: 'saveNote',
        path: 'types/project.md',
      },
    ])
  })

  it('preserves desktop workspace alias casing in Type schema relationship rewrites', () => {
    const snapshot = schemaReferenceSnapshot(['archive', 'projects'], {
      relationshipTarget: 'TV/projects/remote',
      workspaceAlias: 'TV',
    })
    const result = applyMobileWorkspaceEditWithWrites(snapshot, {
      folderPath: 'archive',
      noteId: 'projects/remote.md',
      type: 'moveNoteToFolder',
    })
    const project = result.snapshot.typeDefinitions?.Project

    expect(project?.relationships?.depends_on).toEqual(['[[TV/archive/remote]]'])
    expect(project?.rawContent).toContain('[[TV/archive/remote]]')
    expect(project?.rawContent).not.toContain('[[TV/projects/remote]]')
  })

  it('retargets Type schema relationship refs when folder subtrees are renamed', () => {
    const snapshot = schemaReferenceSnapshot(['projects'])
    const result = applyMobileWorkspaceEditWithWrites(snapshot, {
      folderPath: 'projects',
      name: 'archive',
      type: 'renameFolder',
    })
    const project = result.snapshot.typeDefinitions?.Project

    expect(project?.relationships?.depends_on).toEqual(['[[team/archive/remote]]'])
    expect(project?.rawContent).toContain('[[team/archive/remote]]')
    expect(result.writes).toEqual([
      { kind: 'renameFolder', path: 'projects', toPath: 'archive' },
      {
        content: project?.rawContent,
        kind: 'saveNote',
        path: 'types/project.md',
      },
    ])
  })
})

function schemaReferenceSnapshot(
  folderPaths: string[],
  options: {
    relationshipTarget?: string
    workspaceAlias?: string
  } = {},
): MobileWorkspaceSnapshot {
  const base = workspaceScenarioForId('default')
  const remote = remoteTeamNote(requiredFixture(base.notes[1]), options.workspaceAlias ?? 'team')

  return {
    ...base,
    allNotes: [remote],
    folderPaths,
    notes: [remote],
    typeDefinitions: {
      Project: projectTypeDefinition(options.relationshipTarget ?? 'team/projects/remote'),
    },
  }
}

function remoteTeamNote(base: MobileNote, workspaceAlias: string): MobileNote {
  return {
    ...base,
    id: 'projects/remote.md',
    path: 'projects/remote.md',
    rawContent: '# Remote\n\nMove me.\n',
    relationships: [],
    title: 'Remote',
    workspace: 'Team',
    workspaceAlias,
  }
}

function projectTypeDefinition(relationshipTarget: string): MobileTypeDefinition {
  return {
    path: 'types/project.md',
    rawContent: [
      '---',
      'type: Type',
      'depends_on:',
      `  - "[[${relationshipTarget}]]"`,
      '---',
      '# Project',
      '',
    ].join('\n'),
    relationships: {
      depends_on: [`[[${relationshipTarget}]]`],
    },
  }
}
