import { describe, expect, it } from 'vitest'
import { workspaceScenarios } from '../fixtures/workspaceFixtures'
import { mobileWorkspaceKey, type MobileWorkspaceKeyFlags } from './mobileWorkspaceKey'

const flags: MobileWorkspaceKeyFlags = {
  forceDesktopPanels: false,
  initialCommandPaletteOpen: false,
  initialEditorEditing: true,
  initialEditorEditingMode: 'wysiwyg',
  layoutProbe: false,
  mobileActionAdapterProbe: false,
  mobileCommandPaletteProbe: false,
  mobileKeyboardShortcutProbe: false,
  sourceSelectionProbe: false,
  tableOfContentsProbe: false,
  tabletTransitionProbe: false,
  wysiwygAutocompleteProbe: false,
  wysiwygExternalLinkProbe: false,
  wysiwygFormatCommandProbe: false,
  wysiwygInputTransformProbe: false,
  wysiwygMarkdownBlockProbe: false,
  wysiwygMathEditProbe: false,
  wysiwygMutationProbe: false,
  wysiwygTableCommandMutationProbe: false,
  wysiwygWikilinkInsertProbe: false,
}

function key(overrides: Partial<Parameters<typeof mobileWorkspaceKey>[0]> = {}) {
  return mobileWorkspaceKey({
    flags,
    qaRun: null,
    scenarioId: null,
    snapshot: workspaceScenarios.default,
    source: 'fixture',
    workspacePersistenceProbe: false,
    wysiwygPersistenceProbe: false,
    ...overrides,
  })
}

describe('mobile workspace key', () => {
  it('is stable for the same workspace state', () => {
    expect(key()).toBe(key())
  })

  it('changes when workspace identity changes', () => {
    expect(key({ source: 'native' })).not.toBe(key())
    expect(key({ qaRun: 'second-run' })).not.toBe(key())
  })

  it('changes when a probe requires a fresh workspace', () => {
    expect(key({ flags: { ...flags, initialCommandPaletteOpen: true } })).not.toBe(key())
    expect(key({ workspacePersistenceProbe: true })).not.toBe(key())
  })
})
