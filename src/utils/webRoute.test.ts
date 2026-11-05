import { describe, expect, it } from 'vitest'
import type { VaultEntry } from '../types'
import {
  findRouteEntry,
  parseWebRoute,
  routeMatchesVault,
  routeNotePath,
  routeVaultSlug,
  webRouteForState,
  webRouteSearch,
  webRoutesEqual,
} from './webRoute'

const VAULT_PATH = '/Users/mock/demo-vault-v2'
const VAULTS = [{ label: 'demo-vault-v2', path: VAULT_PATH }, { label: 'Work', path: '/Users/mock/work' }]

function entry(path: string): VaultEntry {
  return { path } as VaultEntry
}

describe('parseWebRoute', () => {
  it('reads the vault, note and view of a URL', () => {
    expect(parseWebRoute('?vault=work&note=people/ada.md&view=active.yml')).toEqual({
      vault: 'work',
      note: 'people/ada.md',
      view: 'active.yml',
    })
  })

  it('decodes encoded paths and trims empty values to nothing', () => {
    expect(parseWebRoute('?note=Daily%20Notes%2F2026-10-24.md&vault=%20')).toEqual({
      vault: null,
      note: 'Daily Notes/2026-10-24.md',
      view: null,
    })
  })

  it('drops paths that would leave the vault', () => {
    expect(parseWebRoute('?note=../secrets.md&view=a/../../b.yml').note).toBeNull()
    expect(parseWebRoute('?view=a/../../b.yml').view).toBeNull()
  })

  it('reads a URL without a route as no route', () => {
    expect(parseWebRoute('')).toEqual({ vault: null, note: null, view: null })
  })
})

describe('webRouteSearch', () => {
  it('writes the route with readable slashes and keeps queries it does not own', () => {
    const search = webRouteSearch({ vault: 'work', note: 'people/ada lovelace.md', view: null }, '?utm=mail&view=old.yml')
    expect(search).toBe('?utm=mail&vault=work&note=people/ada+lovelace.md')
    expect(parseWebRoute(search).note).toBe('people/ada lovelace.md')
  })

  it('writes an empty route as no query at all', () => {
    expect(webRouteSearch({ vault: null, note: null, view: null }, '?note=a.md')).toBe('')
  })
})

describe('webRoutesEqual', () => {
  it('compares every part of a route', () => {
    const route = { vault: 'work', note: 'a.md', view: null }
    expect(webRoutesEqual(route, { ...route })).toBe(true)
    expect(webRoutesEqual(route, { ...route, view: 'v.yml' })).toBe(false)
  })
})

describe('routeNotePath', () => {
  it('makes absolute local paths relative to the vault', () => {
    expect(routeNotePath({ notePath: `${VAULT_PATH}/people/ada.md`, vaultPath: VAULT_PATH })).toBe('people/ada.md')
  })

  it('keeps remote paths, which are already relative', () => {
    expect(routeNotePath({ notePath: 'people/ada.md', vaultPath: VAULT_PATH })).toBe('people/ada.md')
    expect(routeNotePath({ notePath: 'welcome.md', vaultPath: '' })).toBe('welcome.md')
  })

  it('has no route for a file outside the vault', () => {
    expect(routeNotePath({ notePath: '/elsewhere/ada.md', vaultPath: VAULT_PATH })).toBeNull()
  })
})

describe('findRouteEntry', () => {
  it('finds the entry a route names, whatever the shape of its path', () => {
    const local = entry(`${VAULT_PATH}/people/ada.md`)
    const remote = entry('projects/heron.md')
    expect(findRouteEntry([local, remote], { notePath: 'people/ada.md', vaultPath: VAULT_PATH })).toBe(local)
    expect(findRouteEntry([local, remote], { notePath: 'projects/heron.md', vaultPath: VAULT_PATH })).toBe(remote)
    expect(findRouteEntry([local, remote], { notePath: 'missing.md', vaultPath: VAULT_PATH })).toBeUndefined()
  })
})

describe('routeVaultSlug and routeMatchesVault', () => {
  it('names the open vault with its deep-link slug', () => {
    expect(routeVaultSlug({ vaultPath: VAULT_PATH, vaults: VAULTS })).toBe('demo-vault-v2')
    expect(routeVaultSlug({ vaultPath: '/Users/mock/unknown', vaults: VAULTS })).toBeNull()
  })

  it('matches a route of the open vault or of no vault', () => {
    expect(routeMatchesVault({ vault: null, note: 'a.md', view: null }, 'work')).toBe(true)
    expect(routeMatchesVault({ vault: 'work', note: 'a.md', view: null }, 'work')).toBe(true)
    expect(routeMatchesVault({ vault: 'home', note: 'a.md', view: null }, 'work')).toBe(false)
  })
})

describe('webRouteForState', () => {
  it('names the open note and the selected saved view', () => {
    expect(webRouteForState({
      activeNotePath: `${VAULT_PATH}/people/ada.md`,
      selection: { kind: 'view', filename: 'active.yml' },
      vaultPath: VAULT_PATH,
      vaults: VAULTS,
    })).toEqual({ vault: 'demo-vault-v2', note: 'people/ada.md', view: 'active.yml' })
  })

  it('leaves out the note and view when neither is open', () => {
    expect(webRouteForState({
      activeNotePath: null,
      selection: { kind: 'filter', filter: 'inbox' },
      vaultPath: VAULT_PATH,
      vaults: VAULTS,
    })).toEqual({ vault: 'demo-vault-v2', note: null, view: null })
  })
})
