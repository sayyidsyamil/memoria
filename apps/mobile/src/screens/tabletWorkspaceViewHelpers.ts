import type { MobileViewFilterGroup } from '../workspace/mobileWorkspaceModel'

export function createViewInitialFilters(): MobileViewFilterGroup {
  return { all: [{ field: 'type', op: 'equals', value: '' }] }
}
