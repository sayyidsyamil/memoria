import { Platform, type LayoutRectangle } from 'react-native'
import { nativeMobileLaunchSearch } from '../native/mobileNativeKeyCommands'
import { postNativeQaEvent, setNativeQaSinkUrl } from './nativeQaSink'

/** Opt-in, loopback-only native presentation evidence; never note or vault content. */
export function recordNativeStartupPreviewLayout(event: { nativeEvent: { layout: LayoutRectangle } }) {
  const params = new URLSearchParams(nativeMobileLaunchSearch())
  if (params.get('startupPreviewProbe') !== '1') return
  const layout = event.nativeEvent.layout
  if (layout.width <= 0 || layout.height <= 0) return
  setNativeQaSinkUrl(params.get('metricSink'))
  postNativeQaEvent({ id: 'startup.preview', platform: Platform.OS, ...layout })
}
