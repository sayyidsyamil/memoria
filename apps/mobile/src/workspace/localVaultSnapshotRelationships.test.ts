import { describe, expect, it } from 'vitest'
import { buildLocalVaultWorkspaceSnapshot } from './localVaultSnapshot'
import { vaultFile, realVaultRelationshipFiles, memoriaMobileContent } from './localVaultSnapshotTestFixtures'

describe('buildLocalVaultWorkspaceSnapshot', () => {
  it('maps real vault frontmatter into mobile notes, relationships, and type colors', () => {
    const snapshot = buildLocalVaultWorkspaceSnapshot({
      files: realVaultRelationshipFiles(),
      vaultLabel: 'Laputa',
      vaultPath: '/Users/luca/Laputa',
    })

    expect(snapshot.source).toMatchObject({ kind: 'localVault', label: 'Laputa', totalNotes: 3 })
    expect(snapshot.notes).toHaveLength(1)
    expect(snapshot.notes[0]).toMatchObject({
      aliases: ['Mobile App'],
      outgoingLinks: ['workflow-orchestration'],
      rawContent: memoriaMobileContent,
      title: 'Memoria Mobile',
      type: 'Project',
      noteWidth: 'wide',
      typeTone: 'red',
      workspace: 'Laputa',
    })
    expect(snapshot.notes[0]?.relationships[0]).toMatchObject({
      key: 'related_to',
    })
    expect(snapshot.notes[0]?.relationships[0]?.values[0]).toMatchObject({
      ref: '[[workflow-orchestration|Workflow Orchestration]]',
      title: 'Workflow Orchestration',
      type: 'Note',
    })
    expect((snapshot.notes[0]?.editorBlocks ?? []).some((block) => block.kind === 'table')).toBe(true)
    expect(snapshot.allNotes?.map((note) => note.title)).toContain('Workflow Orchestration')
  })

  it('keeps internal desktop metadata out of mobile properties without hiding relationships', () => {
    const snapshot = buildLocalVaultWorkspaceSnapshot({
      files: [
        vaultFile('source.md', `---
type: Note
_display: sheet
_sheet:
_plugin_hint: local
display: public
related_to:
  - "[[target]]"
---
# Source
`),
        vaultFile('target.md', `---
type: Project
---
# Target
`),
      ],
      vaultLabel: 'Laputa',
      vaultPath: '/Users/luca/Laputa',
    })

    expect(snapshot.notes[0]?.properties).toEqual([{
      key: 'display',
      label: 'Display',
      value: 'public',
    }])
    expect(snapshot.notes[0]?.relationships[0]).toMatchObject({
      key: 'related_to',
      values: [expect.objectContaining({ title: 'Target', type: 'Project' })],
    })
  })

  it('resolves relationship refs through target aliases and folded title targets like desktop wikilinks', () => {
    const snapshot = buildLocalVaultWorkspaceSnapshot({
      files: [
        vaultFile('relationships/source.md', `---
type: Note
related_to:
  - "[[Newsletter]]"
has:
  - "[[Cafe Notes.md]]"
---
# Source
`),
        vaultFile('relationships/launch-plan.md', `---
type: Project
aliases:
  - Newsletter
---
# Longform Launch Plan
`),
        vaultFile('journal/cafe-notes.md', `---
type: Journal
---
# Café Notes
`),
      ],
      vaultLabel: 'Laputa',
      vaultPath: '/Users/luca/Laputa',
    })

    expect(snapshot.notes[0]?.relationships[0]?.values[0]).toMatchObject({
      id: 'relationships/launch-plan.md',
      ref: '[[Newsletter]]',
      title: 'Longform Launch Plan',
      type: 'Project',
    })
    expect(snapshot.notes[0]?.relationships[1]?.values[0]).toMatchObject({
      id: 'journal/cafe-notes.md',
      ref: '[[Cafe Notes.md]]',
      title: 'Café Notes',
      type: 'Journal',
    })
  })

  it('preserves an authored relationship label when its target is missing', () => {
    const snapshot = buildLocalVaultWorkspaceSnapshot({
      files: [vaultFile('source.md', `---
type: Goal
Belongs to:
  - "[[goal/2021-learn-new-things|Learn new things]]"
---
# Source
`)],
      vaultLabel: 'Laputa',
      vaultPath: '/Users/luca/Laputa',
    })

    expect(snapshot.notes[0]?.relationships[0]?.values[0]).toMatchObject({
      id: undefined,
      ref: '[[goal/2021-learn-new-things|Learn new things]]',
      title: 'Learn new things',
      type: 'Note',
      typeTone: 'gray',
    })
  })

  it('annotates notes with the workspace alias and resolves alias-prefixed relationship refs', () => {
    const snapshot = buildLocalVaultWorkspaceSnapshot({
      files: [
        vaultFile('relationships/source.md', `---
type: Note
related_to:
  - "[[team/refs/target]]"
---
# Source
`),
        vaultFile('refs/target.md', `---
type: Project
---
# Target
`),
      ],
      vaultAlias: 'team',
      vaultLabel: 'Team Notes',
      vaultPath: '/Users/luca/Team Notes',
    })

    expect(snapshot.source).toMatchObject({ alias: 'team', label: 'Team Notes' })
    expect(snapshot.notes[0]).toMatchObject({ workspace: 'Team Notes', workspaceAlias: 'team' })
    expect(snapshot.notes[0]?.relationships[0]?.values[0]).toMatchObject({
      id: 'refs/target.md',
      ref: '[[team/refs/target]]',
      title: 'Target',
      type: 'Project',
    })
  })
})
