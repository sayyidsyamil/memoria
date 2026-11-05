import { defaultMobileSettings, parseMobileSettings, type MobileSettings } from './mobileSettings'

type SettingsStorage = {
  read: () => Promise<MobileSettings>
  write: (settings: MobileSettings) => Promise<void>
}
type SettingsState = { settings: MobileSettings; ready: boolean; saving: boolean; error: 'load' | 'save' | null }

export function createMobileSettingsController(storage: SettingsStorage) {
  let state: SettingsState = { settings: defaultMobileSettings, ready: false, saving: false, error: null }
  let loading = false
  const listeners = new Set<() => void>()
  const publish = (next: SettingsState) => {
    state = next
    for (const listener of listeners) listener()
  }
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    load: async () => {
      if (loading || state.ready) return
      loading = true
      try { publish({ settings: await storage.read(), ready: true, saving: false, error: null }) }
      catch { publish({ ...state, error: 'load' }) }
      finally { loading = false }
    },
    update: async (patch: Partial<MobileSettings>) => {
      if (!state.ready || state.saving) return false
      publish({ ...state, saving: true, error: null })
      try {
        const settings = parseMobileSettings(JSON.stringify({ ...state.settings, ...patch }))
        await storage.write(settings)
        publish({ settings, ready: true, saving: false, error: null })
        return true
      } catch { publish({ ...state, saving: false, error: 'save' }); return false }
    },
  }
}
