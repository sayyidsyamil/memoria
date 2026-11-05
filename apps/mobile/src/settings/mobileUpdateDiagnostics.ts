import { mobileText } from '../i18n/mobileText'
import type { MobileUpdateRuntime, MobileUpdateState } from './mobileUpdateChannel.types'

export function mobileUpdateDiagnostics(runtime: MobileUpdateRuntime, state: MobileUpdateState) {
  const unknown = mobileText('mobile.updates.unknown')
  const channel = mobileText(state.selected === 'stable' ? 'settings.releaseStable' : 'settings.releaseAlpha')
  return {
    build: nativeBuildLabel(runtime, unknown),
    running: runningUpdateLabel(runtime, unknown),
    runtime: mobileText('mobile.updates.runtime').replace('{runtime}', runtime.runtimeVersion || unknown),
    status: mobileText(runtime.available ? `mobile.updates.${state.phase}` : 'mobile.updates.disabled').replace('{channel}', channel),
    checked: state.checkedAt === null ? null
      : mobileText('mobile.updates.checkedAt').replace('{time}', new Date(state.checkedAt).toLocaleString()),
  }
}

function nativeBuildLabel(runtime: MobileUpdateRuntime, unknown: string) {
  return mobileText('mobile.updates.nativeBuild').replace('{version}', runtime.appVersion || unknown)
    .replace('{build}', runtime.buildVersion || unknown)
}

function runningUpdateLabel(runtime: MobileUpdateRuntime, unknown: string) {
  return runtime.isEmbeddedLaunch ? mobileText('mobile.updates.embedded')
    : mobileText('mobile.updates.runningOta').replace('{update}', runtime.updateId || unknown)
}
