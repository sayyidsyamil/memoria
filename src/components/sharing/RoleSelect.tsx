import { useId } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { translate, type AppLocale } from '../../lib/i18n'
import type { SharedRole } from '../../lib/sharing/vaultAccess'
import { roleKey, SHARED_ROLES } from './shareView'

interface RoleSelectProps {
  value: SharedRole
  onChange: (role: SharedRole) => void
  label: string
  disabled?: boolean
  testId?: string
  locale: AppLocale
}

/** Editor or viewer, for an invitation or an existing share. */
export function RoleSelect({ value, onChange, label, disabled, testId, locale }: RoleSelectProps) {
  const id = useId()
  return (
    <Select value={value} onValueChange={(next) => onChange(next as SharedRole)} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label} className="h-9 w-[7.5rem] shrink-0" data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SHARED_ROLES.map((role) => (
          <SelectItem key={role} value={role}>{translate(locale, roleKey(role))}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
