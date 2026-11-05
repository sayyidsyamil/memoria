import { useEffect, useRef } from 'react'
import type { MobileActionSheetQaTarget } from './tabletWorkspaceTypes'

export function useInitialActionSheetQaTarget(
  onOpenActionSheetQaTarget: (target: MobileActionSheetQaTarget) => void,
  target: MobileActionSheetQaTarget | undefined,
) {
  const openedTargetRef = useRef<MobileActionSheetQaTarget | null>(null)

  useEffect(() => {
    if (!target || openedTargetRef.current === target) return

    openedTargetRef.current = target
    onOpenActionSheetQaTarget(target)
  }, [onOpenActionSheetQaTarget, target])
}
