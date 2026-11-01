import type { MobileDiagramKind } from '../../workspace/mobileDiagramMarkdown'

export type DiagramRequest = {
  type: 'memoria-diagram-render'
  id: number
  kind: MobileDiagramKind
  content: string
  dark: boolean
}
export type DiagramResponse = { type: 'memoria-diagram-result'; id: number; svg?: string; failed?: true }

const maximumSourceBytes = 8 * 1024 * 1024
const maximumSvgBytes = 16 * 1024 * 1024

export function isDiagramRequest(value: unknown): value is DiagramRequest {
  if (!isRecord(value)) return false
  return value.type === 'memoria-diagram-render' && requestId(value.id)
    && diagramKind(value.kind) && boundedString(value.content, maximumSourceBytes) && typeof value.dark === 'boolean'
}

export function isDiagramResponse(value: unknown): value is DiagramResponse {
  if (!isRecord(value)) return false
  return value.type === 'memoria-diagram-result' && requestId(value.id)
    && (value.failed === true || boundedString(value.svg, maximumSvgBytes))
}

function requestId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
function diagramKind(value: unknown): value is MobileDiagramKind { return value === 'mermaid' || value === 'tldraw' }
function boundedString(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
