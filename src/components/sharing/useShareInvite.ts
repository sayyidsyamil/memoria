import { useCallback, useState } from 'react'
import { translate, type AppLocale } from '../../lib/i18n'
import { createShare, type Invitee, parseInvitee, ShareApiError } from '../../lib/sharing/sharesApi'
import { trackShareInvited, trackShareInviteFailed } from '../../lib/sharing/sharingAnalytics'
import { rememberOutgoingShare } from '../../lib/sharing/sharingStore'
import type { SharedRole } from '../../lib/sharing/vaultAccess'
import { scopeKind, shareErrorKey } from './shareView'

export type ShareScopeChoice = 'note' | 'vault'

/** The line under the form: what happened to the last invitation. */
export interface ShareFeedback {
  kind: 'error' | 'success'
  text: string
}

interface ShareInviteOptions {
  vaultId: string
  notePath: string | null
  locale: AppLocale
}

function inviteeKind(invitee: Invitee): 'email' | 'github' {
  return 'email' in invitee ? 'email' : 'github'
}

function errorCodeOf(error: unknown) {
  return error instanceof ShareApiError ? error.code : 'failed'
}

/** The invitation form of the share dialog: who, which role, the note or the whole vault. */
export function useShareInvite({ vaultId, notePath, locale }: ShareInviteOptions) {
  const [invitee, setInvitee] = useState('')
  const [role, setRole] = useState<SharedRole>('editor')
  const [scope, setScope] = useState<ShareScopeChoice>(notePath ? 'note' : 'vault')
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<ShareFeedback | null>(null)
  const path = scope === 'note' ? notePath : null

  const fail = useCallback((key: Parameters<typeof translate>[1]) => {
    setFeedback({ kind: 'error', text: translate(locale, key) })
  }, [locale])

  const invite = useCallback(async () => {
    const parsed = parseInvitee(invitee)
    if (!parsed) {
      fail('sharing.error.invalidInvitee')
      return
    }
    setPending(true)
    try {
      rememberOutgoingShare(await createShare({ vaultId, invitee: parsed, role, path }))
      trackShareInvited(scopeKind(path), role, inviteeKind(parsed))
      setFeedback({ kind: 'success', text: translate(locale, 'sharing.invite.sent', { name: invitee.trim() }) })
      setInvitee('')
    } catch (error) {
      const code = errorCodeOf(error)
      trackShareInviteFailed(scopeKind(path), code)
      fail(shareErrorKey(code))
    } finally {
      setPending(false)
    }
  }, [fail, invitee, locale, path, role, vaultId])

  const editInvitee = useCallback((value: string) => {
    setInvitee(value)
    setFeedback(null)
  }, [])

  return { invitee, editInvitee, role, setRole, scope, setScope, pending, feedback, invite }
}

export type ShareInvite = ReturnType<typeof useShareInvite>
