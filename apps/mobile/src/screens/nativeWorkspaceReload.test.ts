// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MobileVaultPickerContext } from '../workspace/MobileVaultContext'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import type { ReadOnlyWorkspaceRequest } from '../workspace/readOnlyWorkspaceRepository'
import { useWorkspaceEditPipeline } from './tabletWorkspacePersistence'

let root: ReturnType<typeof createRoot> | undefined
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(async () => { await act(async () => root?.unmount()); vi.unstubAllGlobals() })

it('awaits the selected manager action instead of rebuilding a native vault from the launch index', async () => {
  let finish: () => void = () => {}
  const selected = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const other = vi.fn(async () => {})
  const h = await harness('native', [choice('other', false, other), choice('selected', true, selected)])
  let finished = false
  let reload: Promise<unknown> | undefined
  await act(async () => {
    reload = Promise.resolve(h.current().reloadWorkspaceSnapshot()).then(() => { finished = true })
  })
  expect(selected).toHaveBeenCalledOnce()
  expect(other).not.toHaveBeenCalled()
  expect(h.repository.readSnapshot).not.toHaveBeenCalled()
  expect(finished).toBe(false)
  await act(async () => { finish(); await reload })
  expect(finished).toBe(true)
})

it('does not fall back to a synchronous native scan when no catalog selection exists', async () => {
  const h = await harness('native', [])
  await act(async () => { await h.current().reloadWorkspaceSnapshot() })
  expect(h.repository.readSnapshot).not.toHaveBeenCalled()
})

it('retains ordinary non-native repository reload and resets its edit history', async () => {
  const selected = vi.fn(async () => {})
  const h = await harness('fixture', [choice('selected', true, selected)])
  await act(async () => { await h.current().applyWorkspaceEdit({ type: 'toggleFavorite', noteId: 'workflow-orchestration' }) })
  expect(h.current().canUndoWorkspaceEdit).toBe(true)
  await act(async () => { await h.current().reloadWorkspaceSnapshot() })
  expect(h.repository.readSnapshot).toHaveBeenCalledWith(h.request)
  expect(h.current().workspaceSnapshot.noteListSubtitle).toBe('Fresh snapshot')
  expect(h.current().canUndoWorkspaceEdit).toBe(false)
  expect(selected).not.toHaveBeenCalled()
})

function choice(id: string, selected: boolean, select: () => Promise<void>) {
  return { id, label: id, selected, select }
}

async function harness(source: ReadOnlyWorkspaceRequest['source'], choices: ReturnType<typeof choice>[]) {
  const snapshot = workspaceScenarioForId('default')
  const request = { source, vaultRootUri: 'file:///disposable-owned-vault' }
  const repository = { readNoteContent: vi.fn(async () => null), persistWrites: vi.fn(async () => {}),
    readSnapshot: vi.fn(() => ({ ...snapshot, noteListSubtitle: 'Fresh snapshot' })) }
  let current: ReturnType<typeof useWorkspaceEditPipeline> | undefined
  function Probe() {
    const pipeline = useWorkspaceEditPipeline({ repository, repositoryRequest: request, snapshot })
    useEffect(() => { current = pipeline }, [pipeline])
    return null
  }
  root = createRoot(document.createElement('div'))
  await act(async () => root?.render(createElement(MobileVaultPickerContext.Provider,
    { value: { choices, disabled: false, manage: vi.fn() } }, createElement(Probe))))
  return { repository, request, current: () => { if (!current) throw new Error('Probe missing'); return current } }
}
