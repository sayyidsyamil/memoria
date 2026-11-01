import { describe, expect, it } from 'vitest'
import { requiredFixture } from '../fixtures/requiredFixture'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { buildMobileFilePathForNote, buildMobileFilePathForRelativePath } from './mobileNoteFilePath'

describe('mobile note file paths', () => {
  it('copies native vault URIs with encoded path segments', () => {
    const note = requiredFixture(workspaceScenarioForId('default').notes[0])

    expect(buildMobileFilePathForNote({
      note,
      vaultRootUri: 'file:///vault/root',
    })).toEqual({
      ok: true,
      path: 'file:///vault/root/Memoria/Mobile%20UI/Workflow%20Orchestration%20Essay.md',
    })
  })

  it('falls back to portable paths when no native vault root is available', () => {
    const note = requiredFixture(workspaceScenarioForId('default').notes[0])

    expect(buildMobileFilePathForNote({ note, vaultRootUri: null })).toEqual({
      ok: true,
      path: 'Memoria/Mobile UI/Workflow Orchestration Essay.md',
    })
  })

  it('rejects missing notes and unsafe paths', () => {
    expect(buildMobileFilePathForNote({ note: null })).toEqual({ error: 'missing_note', ok: false })
    expect(buildMobileFilePathForNote({
      note: { ...requiredFixture(workspaceScenarioForId('default').notes[0]), id: '../secret.md', path: '' },
    })).toEqual({ error: 'unsafe_path', ok: false })
  })

  it('copies folder paths through the same mobile vault path rules', () => {
    expect(buildMobileFilePathForRelativePath({
      path: 'Memoria/Mobile UI',
      vaultRootUri: 'file:///vault/root',
    })).toEqual({
      ok: true,
      path: 'file:///vault/root/Memoria/Mobile%20UI',
    })

    expect(buildMobileFilePathForRelativePath({ path: 'Memoria/Mobile UI' })).toEqual({
      ok: true,
      path: 'Memoria/Mobile UI',
    })
  })

  it('rejects missing and unsafe relative paths', () => {
    expect(buildMobileFilePathForRelativePath({ path: '' })).toEqual({ error: 'missing_path', ok: false })
    expect(buildMobileFilePathForRelativePath({ path: '../secret' })).toEqual({ error: 'unsafe_path', ok: false })
  })
})
