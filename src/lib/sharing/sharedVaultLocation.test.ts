import { afterEach, describe, expect, it } from 'vitest'
import { currentSharedVaultId, currentVaultBasePath, sharedVaultHref, sharedVaultIdFromPath, vaultBasePath } from './sharedVaultLocation'

afterEach(() => window.history.replaceState(null, '', '/'))

describe('where a shared vault opens', () => {
  it('reads the vault id from the page path', () => {
    expect(sharedVaultIdFromPath('/vaults/v_1/')).toBe('v_1')
    expect(sharedVaultIdFromPath('/vaults/v_1')).toBe('v_1')
    expect(sharedVaultIdFromPath('/')).toBeNull()
    expect(sharedVaultIdFromPath('/vaults/')).toBeNull()
    expect(sharedVaultIdFromPath('/vaults/../etc')).toBeNull()
    expect(vaultBasePath('/vaults/v_1/')).toBe('/vaults/v_1')
    expect(vaultBasePath('/')).toBe('')
  })

  it('links to the vault, or to its shared note', () => {
    expect(sharedVaultHref('v_1', null)).toBe('/vaults/v_1/')
    expect(sharedVaultHref('v_1', 'projects/alpha beta.md')).toBe('/vaults/v_1/?note=projects%2Falpha+beta.md')
  })

  it('follows the current page', () => {
    window.history.replaceState(null, '', '/vaults/v_2/?note=a.md')
    expect(currentSharedVaultId()).toBe('v_2')
    expect(currentVaultBasePath()).toBe('/vaults/v_2')
  })
})
