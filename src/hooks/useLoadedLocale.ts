import { useEffect, useSyncExternalStore } from 'react'
import {
  DEFAULT_APP_LOCALE,
  isLocaleCatalogPending,
  loadLocaleCatalog,
  subscribeLocaleCatalogs,
  type AppLocale,
} from '../lib/i18n'

/**
 * The locale to render with: `locale` once its catalog is available, English while the web
 * build is still loading it (TOL-206). The desktop bundles every catalog, so it gets `locale`.
 */
export function useLoadedLocale(locale: AppLocale): AppLocale {
  const pending = useSyncExternalStore(subscribeLocaleCatalogs, () => isLocaleCatalogPending(locale))

  useEffect(() => {
    if (pending) void loadLocaleCatalog(locale)
  }, [locale, pending])

  return pending ? DEFAULT_APP_LOCALE : locale
}
