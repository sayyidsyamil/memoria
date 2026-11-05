import { describe, expect, it, vi } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import * as suggestions from '../workspace/mobileWorkspaceSuggestions'
import { typeSectionSuggestionOptions } from './tabletWorkspaceTypeSectionSuggestions'

describe('closed type settings', () => {
  it('does not inspect notes for unused suggestions', () => {
    const snapshot = workspaceScenarioForId('default')
    const listSuggestions = vi.spyOn(suggestions, 'mobileListPropertySuggestions')
    const input = {
      enabled: false,
      notes: snapshot.notes,
      readOnlyForm: {
        typeName: 'Essay', typePropertyQuery: '', typeSchemaPropertyName: '',
        typeSchemaRelationshipName: '', typeSchemaRelationshipTarget: '',
      },
      sourceNote: snapshot.notes[0],
      workspaceSnapshot: snapshot,
    }
    try {
      expect(typeSectionSuggestionOptions(input)).toEqual({
        typePropertyOptions: [], typeSchemaPropertyNameOptions: [],
        typeSchemaRelationshipNameOptions: [], typeRelationshipTargetOptions: [], typeSortPropertyOptions: [],
      })
      expect(listSuggestions).not.toHaveBeenCalled()
    } finally {
      listSuggestions.mockRestore()
    }
  })
})
