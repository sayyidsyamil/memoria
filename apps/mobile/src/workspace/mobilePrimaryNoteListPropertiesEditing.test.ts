import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { applyMobileWorkspaceEditWithWrites } from './mobileWorkspaceEditing'
import { parseMobileVaultConfig, serializeMobileVaultConfig } from './mobileVaultConfig'

describe('primary note-list property overrides', () => {
  it('persists primary note-list display overrides through vault config writes', () => {
    const base = workspaceScenarioForId('default')
    const result = applyMobileWorkspaceEditWithWrites(base, {
      listPropertiesDisplay: [' status ', 'belongs_to', 'Status', ''],
      target: 'allNotes',
      type: 'updatePrimaryNoteListProperties',
    })

    expect(result.writes).toEqual([{
      config: {
        allNotes: { noteListProperties: ['status', 'belongs_to'] },
      },
      kind: 'saveVaultConfig',
    }])
    expect(result.snapshot.noteListPropertyOverrides).toEqual({
      allNotes: ['status', 'belongs_to'],
    })
    expect(result.snapshot.vaultConfig).toEqual({
      allNotes: { noteListProperties: ['status', 'belongs_to'] },
    })

    const reset = applyMobileWorkspaceEditWithWrites(result.snapshot, {
      listPropertiesDisplay: [],
      target: 'allNotes',
      type: 'updatePrimaryNoteListProperties',
    })

    expect(reset.writes).toEqual([{
      config: {
        allNotes: { noteListProperties: null },
      },
      kind: 'saveVaultConfig',
    }])
    expect(reset.snapshot.noteListPropertyOverrides).toBeUndefined()
    expect(reset.snapshot.vaultConfig).toEqual({
      allNotes: { noteListProperties: null },
    })
  })

  it('preserves unrelated vault config when resetting one primary list target', () => {
    const base = {
      ...workspaceScenarioForId('default'),
      vaultConfig: {
        allNotes: {
          fileVisibility: { images: true, pdfs: false, unsupported: true },
          noteListProperties: ['tags'],
        },
        defaultNoteWidth: 'wide' as const,
        inbox: { explicitOrganization: true, noteListProperties: ['status'] },
      },
    }

    const result = applyMobileWorkspaceEditWithWrites(base, {
      listPropertiesDisplay: [],
      target: 'inbox',
      type: 'updatePrimaryNoteListProperties',
    })

    expect(result.snapshot.noteListPropertyOverrides).toEqual({ allNotes: ['tags'] })
    expect(result.writes).toEqual([{
      config: {
        allNotes: {
          fileVisibility: { images: true, pdfs: false, unsupported: true },
          noteListProperties: ['tags'],
        },
        defaultNoteWidth: 'wide',
        inbox: { explicitOrganization: true, noteListProperties: null },
      },
      kind: 'saveVaultConfig',
    }])
  })

  it('persists All Notes file visibility with primary note-list display overrides', () => {
    const base = workspaceScenarioForId('default')
    const result = applyMobileWorkspaceEditWithWrites(base, {
      allNotesFileVisibility: { images: true, pdfs: true, unsupported: false },
      listPropertiesDisplay: ['status'],
      target: 'allNotes',
      type: 'updatePrimaryNoteListProperties',
    })

    expect(result.snapshot.noteListPropertyOverrides).toEqual({ allNotes: ['status'] })
    expect(result.snapshot.vaultConfig).toEqual({
      allNotes: {
        fileVisibility: { images: true, pdfs: true, unsupported: false },
        noteListProperties: ['status'],
      },
    })
    expect(result.writes).toEqual([{
      config: result.snapshot.vaultConfig,
      kind: 'saveVaultConfig',
    }])
  })

  it('round-trips All Notes file visibility through vault config serialization', () => {
    const serialized = serializeMobileVaultConfig({
      allNotes: {
        fileVisibility: { images: true, pdfs: false, unsupported: true },
        noteListProperties: ['status'],
      },
      defaultNoteWidth: 'wide',
    })

    expect(parseMobileVaultConfig(serialized)).toEqual({
      allNotes: {
        fileVisibility: { images: true, pdfs: false, unsupported: true },
        noteListProperties: ['status'],
      },
      defaultNoteWidth: 'wide',
    })
    expect(parseMobileVaultConfig(JSON.stringify({
      allNotes: {
        fileVisibility: { images: 1, pdfs: true },
      },
      defaultNoteWidth: 'expanded',
    }))).toEqual({
      allNotes: {
        fileVisibility: { images: false, pdfs: true, unsupported: false },
      },
    })
  })

  it('round-trips desktop property display modes through mobile vault config serialization', () => {
    const serialized = serializeMobileVaultConfig({
      propertyDisplayModes: {
        Estimate: 'number',
        People: 'tags',
      },
    })

    expect(parseMobileVaultConfig(serialized)).toEqual({
      propertyDisplayModes: {
        Estimate: 'number',
        People: 'tags',
      },
    })
    expect(parseMobileVaultConfig(JSON.stringify({
      property_display_modes: {
        Deadline: 'date',
        EmptyTextMode: 'text',
        Invalid: 'rating',
      },
    }))).toEqual({
      propertyDisplayModes: {
        Deadline: 'date',
      },
    })
  })
})
