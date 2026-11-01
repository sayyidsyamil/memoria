import { describe, expect, it, vi } from 'vitest'

vi.mock('expo-clipboard', () => ({
  getStringAsync: vi.fn(),
  setStringAsync: vi.fn(),
}))

import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import type { ReadOnlyWorkspaceRequest } from '../workspace/readOnlyWorkspaceRepository'
import {
  assertNativeMobileActionAdapterProofs,
  formatNativeMobileActionAdapterFailures,
  nativeMobileActionAdapterLogLine,
  nativeMobileActionAdapterProbeEnabled,
  nativeMobileActionAdapterProof,
  parseNativeMobileActionAdapterProofs,
  type NativeMobileActionAdapterProof,
} from './nativeMobileActionAdapterProbe'

describe('native mobile action adapter probe', () => {
  it('builds a passing proof for note file, folder, clipboard, deep-link, and PDF actions', async () => {
    let clipboardText = ''
    const proof = await nativeMobileActionAdapterProof({
      dependencies: {
        clipboardReader: vi.fn(async () => clipboardText),
        clipboardWriter: vi.fn(async (text) => {
          clipboardText = text
          return true
        }),
      },
      repositoryRequest: requestFixture(),
      snapshot: workspaceScenarioForId('default'),
    })

    expect(proof).toMatchObject({
      clipboardDeepLinkRoundTrip: true,
      clipboardFilePathRoundTrip: true,
      deepLinkBuilt: true,
      filePathBuilt: true,
      folderRevealOpened: true,
      noteOpenOpened: true,
      noteRevealOpened: true,
      pdfExported: true,
      pdfHtmlRendered: true,
      selectedNoteId: 'workflow-orchestration',
    })
    expect(assertNativeMobileActionAdapterProofs([proof])).toEqual([])
  })

  it('parses simulator log proofs', () => {
    const proof = passingProof()

    expect(parseNativeMobileActionAdapterProofs(nativeMobileActionAdapterLogLine(proof))).toEqual([proof])
  })

  it('reports missing or incomplete action-adapter proof stages', () => {
    expect(formatNativeMobileActionAdapterFailures(
      assertNativeMobileActionAdapterProofs([]),
    )).toContain('mobile.actionAdapters')
    expect(assertNativeMobileActionAdapterProofs([{
      ...passingProof(),
      clipboardDeepLinkRoundTrip: false,
      noteOpenOpened: false,
    }])).toEqual([
      {
        id: 'mobile.actionAdapters.copyDeepLink',
        message: 'Native action-adapter probe copies and reads back the selected-note deep link',
      },
      {
        id: 'mobile.actionAdapters.openFile',
        message: 'Native action-adapter probe routes selected-note open through the file opener boundary',
      },
    ])
  })

  it('detects the native QA query flag', () => {
    expect(nativeMobileActionAdapterProbeEnabled(new globalThis.URLSearchParams('mobileActionAdapterProbe=1'))).toBe(true)
    expect(nativeMobileActionAdapterProbeEnabled(new globalThis.URLSearchParams('mobileActionAdapterProbe=0'))).toBe(false)
  })
})

function requestFixture(): ReadOnlyWorkspaceRequest {
  return {
    scenarioId: 'default',
    source: 'fixture',
    vaultAlias: 'memoria-vault',
    vaultLabel: 'Memoria Vault',
    vaultRootUri: 'file:///memoria-vault',
  }
}

function passingProof(): NativeMobileActionAdapterProof {
  return {
    clipboardDeepLinkRoundTrip: true,
    clipboardFilePathRoundTrip: true,
    deepLinkBuilt: true,
    filePathBuilt: true,
    folderRevealOpened: true,
    noteOpenOpened: true,
    noteRevealOpened: true,
    pdfExported: true,
    pdfHtmlRendered: true,
    selectedNoteId: 'workflow-orchestration',
  }
}
