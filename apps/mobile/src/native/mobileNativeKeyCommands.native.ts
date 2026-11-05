import { requireOptionalNativeModule } from 'expo'
import {
  mobileLaunchSearchEnvironmentName,
  mobileLaunchSearchFromNativeInputs,
  type NativeMobileKeyCommandsModule,
} from './mobileNativeKeyCommandsContract'

let cachedModule: NativeMobileKeyCommandsModule | null | undefined

export function optionalNativeMobileKeyCommandsModule(): NativeMobileKeyCommandsModule | null {
  if (cachedModule !== undefined) return cachedModule
  cachedModule = requireOptionalNativeModule<NativeMobileKeyCommandsModule>('MemoriaKeyCommands')
  return cachedModule
}

export function nativeMobileKeyCommandsAvailable(
  module: NativeMobileKeyCommandsModule | null = optionalNativeMobileKeyCommandsModule(),
) {
  if (!module) return false
  return module.isSupported?.() ?? true
}

export function nativeMobileLaunchSearch(
  module: NativeMobileKeyCommandsModule | null = optionalNativeMobileKeyCommandsModule(),
) {
  return mobileLaunchSearchFromNativeInputs({
    args: module?.launchArguments?.() ?? [],
    environmentSearch: module?.environmentValue?.(mobileLaunchSearchEnvironmentName),
  })
}
