import { Eye } from '@phosphor-icons/react'
import { useVaultAccess } from '../../hooks/useVaultAccess'
import { translate, type AppLocale } from '../../lib/i18n'
import { canWritePath } from '../../lib/sharing/vaultAccess'

interface SharedReadOnlyBannerProps {
  path: string
  locale?: AppLocale
}

/** A note someone shared with the user to view (TOL-237): says so above the read-only editor. */
export function SharedReadOnlyBanner({ path, locale = 'en' }: SharedReadOnlyBannerProps) {
  const access = useVaultAccess()
  if (access.kind !== 'shared' || canWritePath(access, path)) return null
  return (
    <div
      role="status"
      data-testid="shared-read-only-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 16px',
        background: 'var(--muted)',
        borderBottom: '1px solid var(--border)',
        fontSize: 12,
        color: 'var(--muted-foreground)',
        flexShrink: 0,
      }}
    >
      <Eye size={13} weight="bold" aria-hidden="true" />
      <span>{translate(locale, 'sharing.readOnly.banner')}</span>
    </div>
  )
}
