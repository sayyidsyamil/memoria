import { useState } from 'react'
import { useMobileAnalytics } from '../../analytics/useMobileAnalytics'
import { type EditorBridge, useBridgeState } from '@10play/tentap-editor'
import { useRegisteredMobileEditorCommands, type RegisterMobileEditorCommands } from '../../workspace/mobileEditorCommands'
import { MobileEditorFindBar } from './MobileEditorFindBar'
import type { MobileFindEditorBridge, MobileFindSnapshot, MobileFindRequest } from './MobileWysiwygFindBridge'

export function MobileWysiwygFind({ editor, register, onBeforeReplace }: {
  editor: EditorBridge
  register?: RegisterMobileEditorCommands
  onBeforeReplace: () => void
}) {
  const [session, setSession] = useState<{ replace: boolean; id: number } | null>(null)
  const analytics = useMobileAnalytics()
  const state = useBridgeState(editor) as { mobileFind?: MobileFindSnapshot }
  const bridge = editor as EditorBridge & MobileFindEditorBridge
  const open = (replace: boolean) => {
    bridge.updateMobileFind({ kind: 'close' })
    setSession((current) => ({ replace, id: (current?.id ?? 0) + 1 }))
    analytics.capture({ name: 'mobile_editor_tool_opened', tool: replace ? 'replace' : 'find' })
  }
  useRegisteredMobileEditorCommands(register, {
    findInNote: () => open(false),
    replaceInNote: () => open(true),
  })
  if (session === null) return null
  const onRequest = (request: MobileFindRequest) => {
    if (request.kind === 'replace') onBeforeReplace()
    bridge.updateMobileFind(request)
  }
  const onClose = () => {
    bridge.updateMobileFind({ kind: 'close' })
    setSession(null)
    editor.focus()
  }
  return <MobileEditorFindBar key={session.id} replace={session.replace} onClose={onClose} onRequest={onRequest}
    snapshot={state.mobileFind ?? { activeIndex: 0, matchCount: 0, error: null }} />
}
