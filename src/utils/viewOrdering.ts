import type { ViewDefinition, ViewFileCore } from './viewSchema'

export type ViewMoveDirection = 'up' | 'down'
export type ViewMoveHandler = (filename: string, direction: ViewMoveDirection) => Promise<void> | void
export type ViewReorderHandler = (orderedFilenames: string[]) => Promise<void> | void

export interface ViewOrderUpdate {
  filename: string
  definition: ViewDefinition
}

function orderedViewIndex<T extends Pick<ViewFileCore, 'filename'>>(views: T[], filename: string): number {
  return views.findIndex((view) => view.filename === filename)
}

function destinationIndex(index: number, direction: ViewMoveDirection): number {
  if (direction === 'up') return index - 1
  return index + 1
}

export function canMoveView<T extends Pick<ViewFileCore, 'filename'>>(views: T[], filename: string, direction: ViewMoveDirection): boolean {
  const index = orderedViewIndex(views, filename)
  if (index === -1) return false
  const nextIndex = destinationIndex(index, direction)
  return nextIndex >= 0 && nextIndex < views.length
}

export function moveView<T extends Pick<ViewFileCore, 'filename'>>(views: T[], filename: string, direction: ViewMoveDirection): T[] | null {
  if (!canMoveView(views, filename, direction)) return null

  const index = orderedViewIndex(views, filename)
  const nextIndex = destinationIndex(index, direction)
  const reordered = [...views]
  const [view] = reordered.splice(index, 1)
  reordered.splice(nextIndex, 0, view)
  return reordered
}

export function orderViewsByFilename<T extends Pick<ViewFileCore, 'filename'>>(views: T[], orderedFilenames: string[]): T[] | null {
  if (views.length !== orderedFilenames.length) return null
  if (new Set(orderedFilenames).size !== orderedFilenames.length) return null

  const viewByFilename = new Map(views.map((view) => [view.filename, view]))
  const ordered = orderedFilenames.map((filename) => viewByFilename.get(filename))
  if (ordered.some((view) => view === undefined)) return null

  return ordered as T[]
}

export function buildViewOrderUpdates(views: ViewFileCore[]): ViewOrderUpdate[] {
  return views.map((view, order) => ({
    filename: view.filename,
    definition: { ...view.definition, order },
  }))
}

export function nextViewOrder<T extends Pick<ViewFileCore, 'definition'>>(views: T[]): number {
  const explicitOrders = views
    .map((view) => view.definition.order)
    .filter((order): order is number => typeof order === 'number' && Number.isFinite(order))

  return explicitOrders.length > 0 ? Math.max(...explicitOrders) + 1 : views.length
}
