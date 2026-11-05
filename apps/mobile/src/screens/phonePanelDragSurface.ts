import { desktopPanelParity } from '../ui/desktopParity'
import type { PhoneWorkspaceState } from './phoneWorkspaceTransitions'

export function phonePanelDragSurface(state: PhoneWorkspaceState, start: { x: number; y: number }, width: number, topInset: number) {
  if (state === 'sidebar' || state === 'properties') return true
  if (state === 'list') return true
  if (start.x < 24) return true
  if (state === 'editor') return start.x > width - 24
  return start.y < topInset + desktopPanelParity.toolbarHeight
}
