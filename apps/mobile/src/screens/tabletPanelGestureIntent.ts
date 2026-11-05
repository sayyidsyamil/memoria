import { desktopPanelParity } from '../ui/desktopParity'

export type TabletDragIntent = 'wait' | 'fail' | 'left' | 'properties'
export type TabletDragGeometry = { width: number; left: number; minimumLeft: number; properties: number; topInset?: number }
type Movement = { x: number; y?: number; dx: number; dy: number }

function targetsProperties({ width, properties }: TabletDragGeometry, { x, dx }: Movement) {
  'worklet'
  const panelWidth = desktopPanelParity.inspectorWidth
  if (properties < panelWidth && x >= width - panelWidth + properties) return true
  return dx < 0 && x >= width - 32
}

function canMoveLeftPanels({ left, minimumLeft }: TabletDragGeometry, dx: number) {
  'worklet'
  return dx < 0 ? left > minimumLeft : left < 0
}

function targetsLeftPanels(geometry: TabletDragGeometry, { x, y = 0 }: Movement) {
  'worklet'
  if (x <= 32) return true
  const listEnd = -geometry.minimumLeft + geometry.left
  if (x >= listEnd) return true
  const sidebarEnd = Math.max(0, listEnd - desktopPanelParity.noteListWidth)
  if (x < sidebarEnd) return true
  return x < listEnd && y < desktopPanelParity.toolbarHeight + (geometry.topInset ?? 0)
}

export function tabletPanelGestureIntent(geometry: TabletDragGeometry, movement: Movement): TabletDragIntent {
  'worklet'
  const { dx, dy } = movement
  if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) return 'fail'
  if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.4) return 'wait'
  if (targetsProperties(geometry, movement)) return 'properties'
  if (!targetsLeftPanels(geometry, movement)) return 'fail'
  return canMoveLeftPanels(geometry, dx) ? 'left' : 'fail'
}
