import { useState } from 'react'
import { getBrowserLanguagePreferences, resolveEffectiveLocale, SYSTEM_UI_LANGUAGE } from '../../../../src/lib/i18n'
import { CollabNote } from './CollabNote'
import { ConnectForm } from './ConnectForm'
import { type CollabSession, loadSession } from './session'

export function CollabApp() {
  const [session, setSession] = useState<CollabSession | null>(loadSession)
  const locale = resolveEffectiveLocale(SYSTEM_UI_LANGUAGE, getBrowserLanguagePreferences())
  if (!session) return <ConnectForm locale={locale} onConnect={setSession} />
  return <CollabNote session={session} locale={locale} />
}
