import { useEffect, useRef } from 'react'
import { useMobileAnalytics } from './useMobileAnalytics'

export function useMobileVaultEvents(root: string | null | undefined) {
  const analytics = useMobileAnalytics()
  const previous = useRef<string | null>(null)
  useEffect(() => {
    if (!root || previous.current === root) return
    if (previous.current) analytics.capture({ name: 'vault_switched' })
    analytics.capture({ name: 'vault_opened' })
    previous.current = root
  }, [analytics, root])
}

export function useMobileSearchEvent(open: boolean) {
  const analytics = useMobileAnalytics()
  const previous = useRef(false)
  useEffect(() => {
    if (open && !previous.current) analytics.capture({ name: 'search_used' })
    previous.current = open
  }, [analytics, open])
}
