import type { TabletTransitionProbeMode } from './tabletWorkspaceTypes'

export function tabletTransitionProbeMode({
  envProbe,
  queryProbe,
}: {
  envProbe: string | null | undefined
  queryProbe: string | null
}): TabletTransitionProbeMode {
  const requestedProbe = envProbe ?? queryProbe
  if (requestedProbe === 'properties') return 'properties'
  if (requestedProbe === '1' || requestedProbe === 'all') return 'all'
  return false
}
