import type { MobileWorkspaceSnapshot } from './mobileWorkspaceModel'

export function sidebarItems(
  snapshot: MobileWorkspaceSnapshot,
  sectionId: MobileWorkspaceSnapshot['sidebarSections'][number]['id'],
) {
  return snapshot.sidebarSections.find((section) => section.id === sectionId)?.items ?? []
}
