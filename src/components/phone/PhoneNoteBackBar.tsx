import { CaretLeft } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { usePhoneNoteStackControls } from '../../hooks/phoneNoteStackStore'
import { translate, type AppLocale } from '../../lib/i18n'

/** The phone layout's way back from a note to the note list (TOL-193); absent elsewhere. */
export function PhoneNoteBackBar({ locale }: { locale: AppLocale }) {
  const { active, backToList } = usePhoneNoteStackControls()
  if (!active) return null
  return (
    <div className="app__phone-back-bar">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={backToList}
        aria-label={translate(locale, 'phone.action.backToNotes')}
        data-testid="phone-back-to-notes"
      >
        <CaretLeft size={16} weight="regular" />
        {translate(locale, 'phone.action.notes')}
      </Button>
    </div>
  )
}
