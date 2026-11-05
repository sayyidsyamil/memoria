import { describe, expect, it } from 'vitest'
import { workspaceScenarioForId } from '../fixtures/workspaceFixtures'
import { applyMobileWorkspaceEditWithWrites } from './mobileWorkspaceEditing'

describe('mobile workspace property display mode editing', () => {
  it('persists property display mode overrides through vault config writes', () => {
    const result = applyMobileWorkspaceEditWithWrites(workspaceScenarioForId('default'), {
      key: 'Priority',
      mode: 'number',
      type: 'updatePropertyDisplayMode',
    })

    expect(result.snapshot.vaultConfig).toEqual({
      propertyDisplayModes: { Priority: 'number' },
    })
    expect(result.writes).toEqual([{
      config: result.snapshot.vaultConfig,
      kind: 'saveVaultConfig',
    }])

    const cleared = applyMobileWorkspaceEditWithWrites(result.snapshot, {
      key: 'Priority',
      mode: null,
      type: 'updatePropertyDisplayMode',
    })

    expect(cleared.snapshot.vaultConfig).toEqual({
      propertyDisplayModes: null,
    })
    expect(cleared.writes).toEqual([{
      config: cleared.snapshot.vaultConfig,
      kind: 'saveVaultConfig',
    }])
  })
})
