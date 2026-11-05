import { beforeEach, expect, it, vi } from 'vitest'
import { recordNativeStartupPreviewLayout } from './nativeStartupPresentation'

const probe = vi.hoisted(() => ({ search: '', post: vi.fn(), configure: vi.fn() }))
vi.mock('../native/mobileNativeKeyCommands', () => ({ nativeMobileLaunchSearch: () => probe.search }))
vi.mock('./nativeQaSink', () => ({ setNativeQaSinkUrl: probe.configure, postNativeQaEvent: probe.post }))
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))

const event = { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } }
beforeEach(() => { probe.search = ''; probe.post.mockClear(); probe.configure.mockClear() })

it('does not publish diagnostics on ordinary app launches', () => {
  recordNativeStartupPreviewLayout(event)
  expect(probe.post).not.toHaveBeenCalled()
  expect(probe.configure).not.toHaveBeenCalled()
})

it('records the real preview layout only for an explicit native QA launch', () => {
  probe.search = '?startupPreviewProbe=1&metricSink=http%3A%2F%2F127.0.0.1%3A9001%2Fmetric'
  recordNativeStartupPreviewLayout(event)
  expect(probe.configure).toHaveBeenCalledWith('http://127.0.0.1:9001/metric')
  expect(probe.post).toHaveBeenCalledExactlyOnceWith({ id: 'startup.preview', platform: 'ios', ...event.nativeEvent.layout })
})

it('does not mistake a zero-size layout for a presented preview', () => {
  probe.search = '?startupPreviewProbe=1'
  recordNativeStartupPreviewLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 0, height: 0 } } })
  expect(probe.post).not.toHaveBeenCalled()
})
