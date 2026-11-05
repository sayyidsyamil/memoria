import { MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { APP_COMMAND_EVENT_NAME, APP_COMMAND_IDS, type AppCommandId } from '../hooks/appCommandDispatcher'
import { type AppLocale, translate } from '../lib/i18n'
import { trackEvent } from '../lib/telemetry'

/** 44 px tall: the touch target floor (TOL-24). */
const TOUCH_ACTION_CLASSNAME = 'h-[44px] gap-2 px-5 text-[15px]'

function runEmptyStateAction(action: string, command: AppCommandId): void {
  trackEvent('web_touch_empty_state_action', { action })
  window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT_NAME, { detail: command }))
}

/**
 * The editor's empty state when the web build is driven by a finger (TOL-24): it asks for a
 * tap and offers search and a new note as buttons instead of keyboard chords.
 */
export function TouchEmptyState({ locale }: { locale: AppLocale }) {
  return (
    <div className="flex flex-col items-center gap-4" data-testid="touch-empty-state">
      <p className="m-0 text-[15px]">{translate(locale, 'editor.empty.tapNote')}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button
          type="button"
          variant="outline"
          className={TOUCH_ACTION_CLASSNAME}
          onClick={() => { runEmptyStateAction('search', APP_COMMAND_IDS.fileQuickOpen) }}
        >
          <MagnifyingGlass size={18} />
          {translate(locale, 'noteList.searchAction')}
        </Button>
        <Button
          type="button"
          className={TOUCH_ACTION_CLASSNAME}
          onClick={() => { runEmptyStateAction('new_note', APP_COMMAND_IDS.fileNewNote) }}
        >
          <Plus size={18} />
          {translate(locale, 'noteList.createNote')}
        </Button>
      </div>
    </div>
  )
}
