import { useMemo, useState, type ComponentType } from 'react'
import type { TLUiOverrides } from 'tldraw'
import { translate, type AppLocale } from '../lib/i18n'
import { GuardedTldrawCanvas } from './GuardedTldrawCanvas'
import { Button } from './ui/button'

interface WhiteboardUiOptions {
  locale: AppLocale
  Dialogs: ComponentType
}

// Remove the action itself so every default menu/shortcut omits the debug toggle.
export const whiteboardUiOverrides: TLUiOverrides = {
  actions(_editor, actions) {
    const userActions = { ...actions }
    delete userActions['toggle-debug-mode']
    return userActions
  },
}

export function useWhiteboardUi({ locale, Dialogs }: WhiteboardUiOptions) {
  const [attempt, setAttempt] = useState(0)
  const ErrorFallback = useMemo(() => function WhiteboardErrorFallback() {
    return (
      <div role="alert" className="tldraw-whiteboard__permission-error">
        <strong>{translate(locale, 'editor.whiteboard.errorTitle')}</strong>
        <span>{translate(locale, 'editor.whiteboard.errorBody')}</span>
        <Button onClick={() => setAttempt((previous) => previous + 1)}>
          {translate(locale, 'editor.whiteboard.retry')}
        </Button>
      </div>
    )
  }, [locale])
  const tldrawUiComponents = useMemo(() => ({
    Canvas: GuardedTldrawCanvas,
    Dialogs,
    DebugMenu: null,
    DebugPanel: null,
    ErrorFallback,
  }), [Dialogs, ErrorFallback])
  return { attempt, tldrawUiComponents }
}
