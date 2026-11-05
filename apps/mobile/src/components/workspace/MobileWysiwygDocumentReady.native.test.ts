import { expect, it, vi } from 'vitest'
import type { EditorBridge } from '@10play/tentap-editor'
import { createMobileEditorDocumentBridge } from './MobileWysiwygDocumentReads.native'

const sdk = vi.hoisted(() => ({ onMessage: vi.fn(() => false) }))
vi.mock('@10play/tentap-editor', () => ({
  BridgeExtension: class { constructor(options: object) { Object.assign(this, options) } },
  CoreBridge: { name: 'coreBridge', extendEditorInstance: () => ({}), onEditorMessage: sdk.onMessage },
  CoreEditorActionType: { EditorReady: 'editor-ready' },
}))

it('uses the explicit ready message even when the SDK has not published a state update', () => {
  const first = createMobileEditorDocumentBridge([])
  const second = createMobileEditorDocumentBridge([])
  const editor = { getEditorState: () => ({}) } as unknown as EditorBridge
  const notify = (type: string) => first.extensions.at(-1)?.onEditorMessage?.({ type, payload: undefined }, editor)
  expect(first.isReady()).toBe(false)
  notify('stateUpdate')
  expect(first.isReady()).toBe(false)
  notify('editor-ready')
  expect(first.isReady()).toBe(true)
  expect(second.isReady()).toBe(false)
  expect(sdk.onMessage).toHaveBeenLastCalledWith({ type: 'editor-ready', payload: undefined }, editor)
})
