import type EN_TRANSLATIONS from './locales/en.json'

type CatalogModules = Record<string, typeof EN_TRANSLATIONS>
type LazyCatalogModules = Record<string, () => Promise<typeof EN_TRANSLATIONS>>

const IS_WEB_BUILD = import.meta.env.VITE_MEMORIA_WEB_BUILD === 'true'

/**
 * Where the translation catalogs come from. The desktop bundles all of them; the web build
 * loads only the active one, so ~1 MB of catalogs stays off the first paint (TOL-206).
 */
export const BUNDLED_LOCALE_MODULES: CatalogModules = IS_WEB_BUILD
  ? {}
  : import.meta.glob<typeof EN_TRANSLATIONS>('./locales/*.json', { eager: true, import: 'default' })

export const LAZY_LOCALE_MODULES: LazyCatalogModules = IS_WEB_BUILD
  ? import.meta.glob<typeof EN_TRANSLATIONS>('./locales/*.json', { import: 'default' })
  : {}
