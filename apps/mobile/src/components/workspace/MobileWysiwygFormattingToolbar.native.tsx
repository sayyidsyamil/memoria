import { useBridgeState, type EditorBridge } from '@10play/tentap-editor'
import type { ComponentProps } from 'react'
import { useMobileDeviceLayout } from '../../ui/useMobileDeviceLayout'
import { MobileCompactFormattingToolbar } from './MobileCompactFormattingToolbar'
import { MobileMarkdownFormattingToolbar } from './MobileMarkdownFormattingToolbar'
import { formattingToolbarSelection } from './mobileFormattingToolbarModel'

type Props = Omit<ComponentProps<typeof MobileCompactFormattingToolbar>, 'selected' | 'inTable' | 'onDismissKeyboard'> & { editor: EditorBridge }

export function MobileWysiwygFormattingToolbar({ editor, ...props }: Props) {
  const phone = useMobileDeviceLayout() === 'phone'
  const state = useBridgeState(editor)
  const tableState = state as typeof state & { canAddRowAfter?: boolean }
  const Toolbar = phone ? MobileCompactFormattingToolbar : MobileMarkdownFormattingToolbar
  return <Toolbar {...props} selected={formattingToolbarSelection(state)} inTable={tableState.canAddRowAfter === true}
    onDismissKeyboard={() => editor.blur()} />
}
