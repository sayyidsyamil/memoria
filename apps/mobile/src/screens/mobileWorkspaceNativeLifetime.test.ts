import { expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { mobileWorkspaceKey, type MobileWorkspaceKeyFlags } from './mobileWorkspaceKey'

const flags: MobileWorkspaceKeyFlags = {
  forceDesktopPanels: false, initialCommandPaletteOpen: false, initialEditorEditing: true,
  initialEditorEditingMode: 'wysiwyg', layoutProbe: false, mobileActionAdapterProbe: false,
  mobileCommandPaletteProbe: false, mobileKeyboardShortcutProbe: false, sourceSelectionProbe: false,
  tableOfContentsProbe: false, tabletTransitionProbe: false, wysiwygAutocompleteProbe: false,
  wysiwygExternalLinkProbe: false, wysiwygFormatCommandProbe: false, wysiwygInputTransformProbe: false,
  wysiwygMarkdownBlockProbe: false, wysiwygMathEditProbe: false, wysiwygMutationProbe: false,
  wysiwygTableCommandMutationProbe: false, wysiwygWikilinkInsertProbe: false,
}

function input() {
  const snapshot = workspaceScenarioForId('default')
  return { flags, qaRun: null, scenarioId: null, snapshot: { ...snapshot,
    source: { kind: 'localVault' as const, alias: 'owned', label: 'Owned', vaultPath: 'file:///owned', totalNotes: 2, visibleNotes: 2 } },
    source: 'native' as const, workspacePersistenceProbe: false, wysiwygPersistenceProbe: false }
}

it('does not remount native workspaces because counts, note order, selection or display labels change', () => {
  const initial = input()
  const updated = input()
  updated.snapshot.notes = [...updated.snapshot.notes].reverse()
  updated.snapshot.selectedNoteId = 'another-note'
  updated.snapshot.source.totalNotes = 6001
  updated.snapshot.source.label = 'Renamed display label'
  expect(mobileWorkspaceKey(updated)).toBe(mobileWorkspaceKey(initial))
})

it('still remounts when the actual native vault root changes, even with the same alias and label', () => {
  const initial = input()
  const updated = input()
  updated.snapshot.source.vaultPath = 'file:///different'
  expect(mobileWorkspaceKey(updated)).not.toBe(mobileWorkspaceKey(initial))
})

it('retains explicit QA launch isolation for the same native vault', () => {
  const initial = input()
  expect(mobileWorkspaceKey({ ...initial, qaRun: 'second-run' })).not.toBe(mobileWorkspaceKey(initial))
})
