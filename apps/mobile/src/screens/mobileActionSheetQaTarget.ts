import type { MobileActionSheetQaTarget } from './tabletWorkspaceTypes'

export function requestedActionSheetQaTarget(searchParams: URLSearchParams): MobileActionSheetQaTarget | undefined {
  const value = searchParams.get('actionSheet')
  if (isMobileActionSheetQaTarget(value)) return value

  return undefined
}

function isMobileActionSheetQaTarget(value: string | null): value is MobileActionSheetQaTarget {
  return value === 'addProperty'
    || value === 'addRelationship'
    || value === 'createView'
    || value === 'editProperty'
    || value === 'editTypeSection'
    || value === 'editTypeVisibility'
    || value === 'editView'
    || value === 'search'
}
