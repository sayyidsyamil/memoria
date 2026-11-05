import { afterEach, describe, expect, it, vi } from 'vitest'
import { requiredFixture } from '../fixtures/requiredFixture'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import {
  MOBILE_FILE_REVEAL_ATTEMPTS_GLOBAL_KEY,
  MOBILE_FILE_REVEALS_GLOBAL_KEY,
  revealMobileFolderPath,
  revealMobileNoteFile,
  type MobileFileRevealer,
} from './mobileNoteFileReveal'

describe('mobile note file reveal', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, MOBILE_FILE_REVEAL_ATTEMPTS_GLOBAL_KEY)
    Reflect.deleteProperty(globalThis, MOBILE_FILE_REVEALS_GLOBAL_KEY)
  })

  it('reveals a selected note through the native revealer', async () => {
    const revealer: MobileFileRevealer = vi.fn().mockResolvedValue({ opened: true, shared: true })
    const note = requiredFixture(workspaceScenarioForId('default').notes[0])

    await expect(revealMobileNoteFile({
      note,
      revealer,
      vaultRootUri: 'file:///vault/root',
    })).resolves.toEqual({
      ok: true,
      opened: true,
      path: 'file:///vault/root/Memoria/Mobile%20UI/Workflow%20Orchestration%20Essay.md',
      shared: true,
    })

    expect(revealer).toHaveBeenCalledWith('file:///vault/root/Memoria/Mobile%20UI/Workflow%20Orchestration%20Essay.md')
    expect(globalValue(MOBILE_FILE_REVEAL_ATTEMPTS_GLOBAL_KEY)).toEqual([{
      noteId: 'workflow-orchestration',
      path: 'file:///vault/root/Memoria/Mobile%20UI/Workflow%20Orchestration%20Essay.md',
      title: 'Workflow Orchestration Essay',
    }])
    expect(globalValue(MOBILE_FILE_REVEALS_GLOBAL_KEY)).toEqual([{
      ok: true,
      opened: true,
      path: 'file:///vault/root/Memoria/Mobile%20UI/Workflow%20Orchestration%20Essay.md',
      shared: true,
    }])
  })

  it('records browser attempts without calling the native revealer', async () => {
    const revealer: MobileFileRevealer = vi.fn()
    const note = requiredFixture(workspaceScenarioForId('default').notes[0])

    await expect(withBrowserRuntime(() => revealMobileNoteFile({
      note,
      revealer,
      vaultRootUri: null,
    }))).resolves.toEqual({
      ok: true,
      opened: false,
      path: 'Memoria/Mobile UI/Workflow Orchestration Essay.md',
      shared: false,
    })

    expect(revealer).not.toHaveBeenCalled()
    expect(globalValue(MOBILE_FILE_REVEAL_ATTEMPTS_GLOBAL_KEY)).toEqual([{
      noteId: 'workflow-orchestration',
      path: 'Memoria/Mobile UI/Workflow Orchestration Essay.md',
      title: 'Workflow Orchestration Essay',
    }])
    expect(globalValue(MOBILE_FILE_REVEALS_GLOBAL_KEY)).toBeUndefined()
  })

  it('reveals a selected folder through the same native revealer boundary', async () => {
    const revealer: MobileFileRevealer = vi.fn().mockResolvedValue({ opened: true, shared: true })

    await expect(revealMobileFolderPath({
      folderPath: 'Memoria/Mobile UI',
      revealer,
      vaultRootUri: 'file:///vault/root',
    })).resolves.toEqual({
      ok: true,
      opened: true,
      path: 'file:///vault/root/Memoria/Mobile%20UI',
      shared: true,
    })

    expect(revealer).toHaveBeenCalledWith('file:///vault/root/Memoria/Mobile%20UI')
    expect(globalValue(MOBILE_FILE_REVEAL_ATTEMPTS_GLOBAL_KEY)).toEqual([{
      folderPath: 'Memoria/Mobile UI',
      path: 'file:///vault/root/Memoria/Mobile%20UI',
    }])
  })

  it('records browser folder reveal attempts without calling the native revealer', async () => {
    const revealer: MobileFileRevealer = vi.fn()

    await expect(withBrowserRuntime(() => revealMobileFolderPath({
      folderPath: 'Memoria/Mobile UI',
      revealer,
    }))).resolves.toEqual({
      ok: true,
      opened: false,
      path: 'Memoria/Mobile UI',
      shared: false,
    })

    expect(revealer).not.toHaveBeenCalled()
    expect(globalValue(MOBILE_FILE_REVEAL_ATTEMPTS_GLOBAL_KEY)).toEqual([{
      folderPath: 'Memoria/Mobile UI',
      path: 'Memoria/Mobile UI',
    }])
  })

  it('does not call the revealer without safe selected targets', async () => {
    const revealer: MobileFileRevealer = vi.fn()

    await expect(revealMobileNoteFile({ note: null, revealer })).resolves.toEqual({
      ok: false,
      reason: 'missingNote',
    })
    await expect(revealMobileNoteFile({
      note: { ...requiredFixture(workspaceScenarioForId('default').notes[0]), id: '../secret.md', path: '' },
      revealer,
    })).resolves.toEqual({
      ok: false,
      reason: 'unsafePath',
    })

    await expect(revealMobileFolderPath({ folderPath: '', revealer })).resolves.toEqual({
      ok: false,
      reason: 'missingPath',
    })
    await expect(revealMobileFolderPath({ folderPath: '../secret', revealer })).resolves.toEqual({
      ok: false,
      reason: 'unsafePath',
    })

    expect(revealer).not.toHaveBeenCalled()
    expect(globalValue(MOBILE_FILE_REVEAL_ATTEMPTS_GLOBAL_KEY)).toBeUndefined()
  })
})

function globalValue(key: string): unknown {
  return (globalThis as Record<string, unknown>)[key]
}

async function withBrowserRuntime<T>(run: () => Promise<T>): Promise<T> {
  Reflect.set(globalThis, 'document', {})
  try {
    return await run()
  } finally {
    Reflect.deleteProperty(globalThis, 'document')
  }
}
