export type MobileUpdateChannel = 'stable' | 'alpha'
export type MobileUpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'current' | 'unavailable' | 'failed' | 'restarting'
export type MobileUpdateState = { selected: MobileUpdateChannel; phase: MobileUpdatePhase; busy: boolean; checkedAt: number | null }
export type MobileUpdateRuntime = {
  available: boolean
  channel: string | null
  updateId: string | null
  appVersion?: string | null
  buildVersion?: string | null
  runtimeVersion?: string | null
  isEmbeddedLaunch?: boolean
  setChannel: (channel: MobileUpdateChannel) => void
  check: () => Promise<boolean>
  fetch: () => Promise<boolean>
  reload: () => Promise<void>
}
export type MobileUpdateDependencies = {
  runtime: MobileUpdateRuntime
  save: (channel: MobileUpdateChannel) => Promise<boolean>
  prepareRestart: () => Promise<() => void>
}
