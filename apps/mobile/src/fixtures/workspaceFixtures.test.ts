import { describe, expect, it } from 'vitest'
import type { FixtureSidebarFolder, WorkspaceScenario } from './workspaceFixtures'
import { fixtureEditorBlocks, fixtureEditorBullets, fixtureNotes, workspaceScenarioForId, workspaceScenarios } from './workspaceFixtures'

describe('workspaceFixtures', () => {
  it('keeps the tablet UI lab anchored on a selected essay note', () => {
    expect(fixtureNotes[0]).toMatchObject({
      id: 'workflow-orchestration',
      type: 'Essay',
    })
    expect(fixtureEditorBullets).toHaveLength(3)
    expect(fixtureEditorBlocks.map((block) => block.kind)).toContain('table')
  })

  it('exposes pressure scenarios for screenshot QA', () => {
    expect(workspaceScenarios['empty-inbox'].notes).toHaveLength(0)
    expect(workspaceScenarios['property-heavy'].notes[0].relationships[0]).toMatchObject({
      kind: 'belongsTo',
      values: [
        { title: 'Memoria Mobile', type: 'Project', typeTone: 'purple' },
        { title: 'Tablet Workspace', type: 'Essay', typeTone: 'green' },
      ],
    })
    expect(workspaceScenarioForId('missing')).toBe(workspaceScenarios.default)
  })

  it('keeps fixture folder ids aligned with vault-relative paths', () => {
    expect(folderIdsForScenario(workspaceScenarios.default)).toEqual(expect.arrayContaining([
      'Writing',
      'Writing/Essays',
      'Memoria',
      'Memoria/Mobile UI',
      'Memoria/Releases',
    ]))
    expect(folderIdsForScenario(workspaceScenarios['folder-tree'])).toEqual(expect.arrayContaining([
      'Memoria/Mobile UI/Tablet Shell',
      'Memoria/Mobile UI/Properties Panel',
      'Attachments/Images',
    ]))
  })
})

function folderIdsForScenario(scenario: WorkspaceScenario) {
  const folderSection = scenario.sidebarSections.find((section) => section.id === 'folders')
  return flattenFolderIds(folderSection?.folders ?? [])
}

function flattenFolderIds(folders: FixtureSidebarFolder[]): string[] {
  return folders.flatMap((folder) => [folder.id, ...flattenFolderIds(folder.children)])
}
