import type { MobileUpdateRuntime } from './mobileUpdateChannel.types'

export const mobileUpdateRuntime: MobileUpdateRuntime = {
  available: false, channel: null, updateId: null,
  setChannel: () => {}, check: async () => false, fetch: async () => false, reload: async () => {},
}
