import { useSyncExternalStore } from 'react'
import type { Awareness } from 'y-protocols/awareness'
import { initials, type PresentUser, presentUsers } from '../../../../packages/collab-client/src/presence'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../../../src/components/ui/tooltip'
import { type AppLocale, translate } from '../../../../src/lib/i18n'

interface PresenceAvatarsProps {
  awareness: Awareness
  locale: AppLocale
}

/** The people in the note; the list object only changes when the people do. */
function usePresentUsers(awareness: Awareness): PresentUser[] {
  const serialized = useSyncExternalStore(
    (notify) => {
      awareness.on('change', notify)
      return () => awareness.off('change', notify)
    },
    () => JSON.stringify(presentUsers(awareness.getStates(), awareness.clientID)),
  )
  return JSON.parse(serialized) as PresentUser[]
}

function displayName(user: PresentUser, locale: AppLocale): string {
  return user.self ? translate(locale, 'collab.presence.you', { name: user.name }) : user.name
}

export function PresenceAvatars({ awareness, locale }: PresenceAvatarsProps) {
  const users = usePresentUsers(awareness)
  return (
    <TooltipProvider>
      <ul className="collab-presence" aria-label={translate(locale, 'collab.presence.label')} data-testid="collab-presence">
        {users.map((user) => (
          <li key={user.clientId}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="collab-presence__avatar"
                  style={{ backgroundColor: user.color }}
                  role="img"
                  aria-label={displayName(user, locale)}
                  data-testid="collab-avatar"
                >
                  {initials(user.name)}
                </span>
              </TooltipTrigger>
              <TooltipContent>{displayName(user, locale)}</TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>
    </TooltipProvider>
  )
}
