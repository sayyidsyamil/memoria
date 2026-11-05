import { useCallback, useState } from 'react'

const AI_AGENTS_ONBOARDING_DISMISSED_STORAGE_NAME = 'memoria:ai-agents-onboarding-dismissed'
const LEGACY_CLAUDE_ONBOARDING_DISMISSED_STORAGE_NAME = 'memoria:claude-code-onboarding-dismissed'
// Memoria's own AI runs inside the app, so the first-run question about coding agents (inherited from Tolaria) is not asked.
// The agents stay available in Settings; set this to true to bring the first-run prompt back.
const ASK_ABOUT_CODING_AGENTS_AT_FIRST_RUN = false

function wasDismissed(): boolean {
  try {
    return (
      localStorage.getItem(AI_AGENTS_ONBOARDING_DISMISSED_STORAGE_NAME) === '1'
      || localStorage.getItem(LEGACY_CLAUDE_ONBOARDING_DISMISSED_STORAGE_NAME) === '1'
    )
  } catch {
    return false
  }
}

function markDismissed(): void {
  try {
    localStorage.setItem(AI_AGENTS_ONBOARDING_DISMISSED_STORAGE_NAME, '1')
    localStorage.setItem(LEGACY_CLAUDE_ONBOARDING_DISMISSED_STORAGE_NAME, '1')
  } catch {
    // localStorage may be unavailable in restricted contexts
  }
}

export function useAiAgentsOnboarding(enabled: boolean) {
  const [dismissed, setDismissed] = useState(() => wasDismissed())

  const dismissPrompt = useCallback(() => {
    markDismissed()
    setDismissed(true)
  }, [])

  return {
    dismissPrompt,
    showPrompt: ASK_ABOUT_CODING_AGENTS_AT_FIRST_RUN && enabled && !dismissed,
  }
}
