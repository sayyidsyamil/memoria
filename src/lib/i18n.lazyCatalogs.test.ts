import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// The web build's catalog sources (TOL-206): nothing bundled, French loaded on demand.
vi.mock('./localeCatalogSources', () => ({
  BUNDLED_LOCALE_MODULES: {},
  LAZY_LOCALE_MODULES: {
    './locales/fr-FR.json': async () => ({ 'locale.en': 'Anglais' }),
  },
}))

import { hasLocaleCatalog, isLocaleCatalogPending, loadLocaleCatalog, subscribeLocaleCatalogs, translate } from './i18n'
import { useLoadedLocale } from '../hooks/useLoadedLocale'

describe('locale catalogs loaded on demand (web build)', () => {
  it('renders in English until the active catalog arrives, then in that locale', async () => {
    expect(isLocaleCatalogPending('fr-FR')).toBe(true)
    const { result } = renderHook(() => useLoadedLocale('fr-FR'))
    expect(result.current).toBe('en')

    await act(async () => { await vi.waitFor(() => expect(hasLocaleCatalog('fr-FR')).toBe(true)) })

    expect(result.current).toBe('fr-FR')
    expect(translate('fr-FR', 'locale.en')).toBe('Anglais')
  })

  it('has nothing to load for English or a locale the build does not split out', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeLocaleCatalogs(listener)

    await loadLocaleCatalog('en')
    await loadLocaleCatalog('de-DE')
    unsubscribe()

    expect(isLocaleCatalogPending('de-DE')).toBe(false)
    expect(listener).not.toHaveBeenCalled()
    expect(renderHook(() => useLoadedLocale('de-DE')).result.current).toBe('de-DE')
  })
})
