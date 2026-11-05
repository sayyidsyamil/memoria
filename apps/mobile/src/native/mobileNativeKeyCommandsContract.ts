export type NativeMobileKeyCommandEvent = {
  altKey: boolean
  code?: string
  ctrlKey: boolean
  key: string
  metaKey: boolean
  shiftKey: boolean
  source: 'native'
}

export type NativeMobileKeyCommandsModule = {
  addListener: (
    eventName: 'onShortcut',
    listener: (event: NativeMobileKeyCommandEvent) => void,
  ) => { remove: () => void }
  environmentValue?: (name: string) => string | null
  isSupported?: () => boolean
  launchArguments?: () => string[]
  setCommandPaletteOpen?: (open: boolean) => Promise<void>
  setModalOpen?: (open: boolean) => Promise<void>
}

export const mobileLaunchSearchEnvironmentName = 'MEMORIA_MOBILE_SEARCH'
export const mobileLaunchSearchArgumentName = '--memoria-mobile-search'

export function mobileLaunchSearchFromNativeInputs({
  args,
  environmentSearch,
}: {
  args: readonly string[]
  environmentSearch?: string | null
}) {
  if (environmentSearch) return normalizeLaunchSearch(environmentSearch)

  return mobileLaunchSearchFromArguments(args)
}

export function mobileLaunchSearchFromArguments(args: readonly string[]) {
  const value = launchArgumentValue(args, mobileLaunchSearchArgumentName)
  if (!value) return ''

  return normalizeLaunchSearch(value)
}

function launchArgumentValue(args: readonly string[], name: string) {
  const index = args.indexOf(name)
  if (index === -1) return null

  const value = args[index + 1]
  if (!value || value.startsWith('--')) return null

  return value
}

function normalizeLaunchSearch(value: string) {
  if (value.startsWith('?')) return value

  const queryStart = value.indexOf('?')
  if (queryStart !== -1) return value.slice(queryStart)

  return `?${value}`
}
