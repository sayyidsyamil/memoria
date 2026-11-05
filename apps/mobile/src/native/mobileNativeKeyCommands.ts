import {
  mobileLaunchSearchEnvironmentName,
  mobileLaunchSearchFromNativeInputs,
  type NativeMobileKeyCommandsModule,
} from './mobileNativeKeyCommandsContract'

export type {
  NativeMobileKeyCommandEvent,
  NativeMobileKeyCommandsModule,
} from './mobileNativeKeyCommandsContract'

export function optionalNativeMobileKeyCommandsModule(): NativeMobileKeyCommandsModule | null {
  return null
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
