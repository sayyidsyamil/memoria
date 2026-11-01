import type { TabletTransitionProbeMode } from './tabletWorkspaceTypes'
import type { MobileWorkspaceSnapshot } from '../workspace/mobileWorkspaceModel'
import type { ReadOnlyWorkspaceRequest } from '../workspace/readOnlyWorkspaceRepository'

export type MobileWorkspaceKeyFlags = {
  forceDesktopPanels: boolean
  initialCommandPaletteOpen: boolean
  initialEditorEditing: boolean
  initialEditorEditingMode: string
  layoutProbe: boolean
  mobileActionAdapterProbe: boolean
  mobileCommandPaletteProbe: boolean
  mobileKeyboardShortcutProbe: boolean
  sourceSelectionProbe: boolean
  tableOfContentsProbe: boolean
  tabletTransitionProbe: TabletTransitionProbeMode
  wysiwygAutocompleteProbe: boolean
  wysiwygExternalLinkProbe: boolean
  wysiwygFormatCommandProbe: boolean
  wysiwygInputTransformProbe: boolean
  wysiwygMarkdownBlockProbe: boolean
  wysiwygMathEditProbe: boolean
  wysiwygMutationProbe: boolean
  wysiwygTableCommandMutationProbe: boolean
  wysiwygWikilinkInsertProbe: boolean
}

type MobileWorkspaceKeyInput = {
  flags: MobileWorkspaceKeyFlags
  qaRun: string | null
  scenarioId: string | null
  snapshot: MobileWorkspaceSnapshot
  source: NonNullable<ReadOnlyWorkspaceRequest['source']>
  workspacePersistenceProbe: boolean
  wysiwygPersistenceProbe: boolean
}

export function mobileWorkspaceKey(input: MobileWorkspaceKeyInput) {
  return [
    ...launchKeySegments(input),
    ...probeKeySegments(input),
    ...snapshotKeySegments(input),
  ].join(':')
}

function launchKeySegments(input: MobileWorkspaceKeyInput) {
  const flags = input.flags
  return [
    input.source,
    input.scenarioId ?? 'default',
    input.qaRun ?? 'interactive',
    flagKey(flags.initialEditorEditing, 'raw-editor', 'read-editor'),
    flags.initialEditorEditingMode,
    flagKey(flags.initialCommandPaletteOpen, 'command-palette-open', 'command-palette-closed'),
    flagKey(flags.forceDesktopPanels, 'desktop-panels', 'responsive-panels'),
  ]
}

function probeKeySegments(input: MobileWorkspaceKeyInput) {
  const flags = input.flags
  return [
    probeKey(flags.mobileCommandPaletteProbe, 'mobile-command-palette'),
    probeKey(flags.mobileKeyboardShortcutProbe, 'mobile-keyboard-shortcut'),
    probeKey(flags.sourceSelectionProbe, 'source-selection'),
    probeKey(flags.mobileActionAdapterProbe, 'mobile-action-adapter'),
    probeKey(flags.tableOfContentsProbe, 'table-of-contents'),
    tabletTransitionProbeKey(flags.tabletTransitionProbe),
    probeKey(input.workspacePersistenceProbe, 'workspace-persistence'),
    probeKey(flags.wysiwygAutocompleteProbe, 'wysiwyg-autocomplete'),
    probeKey(flags.wysiwygExternalLinkProbe, 'wysiwyg-external-link'),
    probeKey(flags.wysiwygFormatCommandProbe, 'wysiwyg-format-command'),
    probeKey(flags.wysiwygInputTransformProbe, 'wysiwyg-input-transform'),
    probeKey(flags.wysiwygMarkdownBlockProbe, 'wysiwyg-markdown-block'),
    probeKey(flags.wysiwygMathEditProbe, 'wysiwyg-math-edit'),
    probeKey(flags.wysiwygTableCommandMutationProbe, 'wysiwyg-table-command-mutation'),
    probeKey(flags.wysiwygWikilinkInsertProbe, 'wysiwyg-wikilink-insert'),
    probeKey(flags.wysiwygMutationProbe, 'wysiwyg-mutation'),
    probeKey(input.wysiwygPersistenceProbe, 'wysiwyg-persistence'),
    flags.layoutProbe ? 'probe' : 'view',
  ]
}

function snapshotKeySegments(input: MobileWorkspaceKeyInput) {
  const sourceInfo = input.snapshot.source
  if (input.source === 'native') return nativeSnapshotKey(sourceInfo)
  return [
    sourceInfo?.kind ?? 'fixture',
    sourceInfo?.alias ?? 'no-workspace-alias',
    sourceInfo?.label ?? 'Memoria Vault',
    sourceInfo?.totalNotes ?? input.snapshot.notes.length,
    input.snapshot.notes[0]?.id ?? 'empty',
    input.snapshot.selectedNoteId ?? 'no-selected-note',
  ]
}

function nativeSnapshotKey(sourceInfo: MobileWorkspaceSnapshot['source']) {
  return [sourceInfo?.kind ?? 'native', sourceInfo?.vaultPath ?? sourceInfo?.alias ?? 'unselected']
}

function probeKey(enabled: boolean, name: string) {
  return enabled ? `${name}-probe` : `no-${name}-probe`
}

function flagKey(enabled: boolean, enabledKey: string, disabledKey: string) {
  return enabled ? enabledKey : disabledKey
}

function tabletTransitionProbeKey(mode: TabletTransitionProbeMode) {
  return mode ? `tablet-transition-probe-${mode}` : 'no-tablet-transition-probe'
}
