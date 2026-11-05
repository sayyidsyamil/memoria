import { parseDocument } from 'yaml'
import type { MobileViewDefinition, MobileViewFilterGroup, MobileViewFilterNode, MobileViewFilterOp } from './mobileWorkspaceModel'

const filterOps = new Set<string>([
  'equals', 'not_equals', 'contains', 'not_contains', 'any_of', 'none_of',
  'is_empty', 'is_not_empty', 'before', 'after',
])

export function parseMobileViewDefinition(content: string, fallbackName: string): MobileViewDefinition | null {
  if (content.length > 262_144) return null
  try {
    const document = parseDocument(content, { schema: 'core', prettyErrors: false, strict: true })
    if (document.errors.length || document.warnings.length) return null
    const value: unknown = document.toJS({ maxAliasCount: 32 })
    return viewDefinition(value, fallbackName)
  } catch {
    return null
  }
}

function viewDefinition(value: unknown, fallbackName: string): MobileViewDefinition | null {
  if (!isRecord(value)) return null
  const filters = Object.hasOwn(value, 'filters') ? filterGroup(value.filters, 0) : { all: [] }
  if (!filters) return null
  return {
    name: optionalText(value.name) ?? fallbackName,
    color: optionalText(value.color),
    icon: optionalText(value.icon),
    sort: optionalText(value.sort),
    order: finiteNumber(value.order),
    listPropertiesDisplay: textList(value.listPropertiesDisplay),
    filters,
  }
}

function filterGroup(value: unknown, depth: number): MobileViewFilterGroup | null {
  if (!isRecord(value) || depth > 32) return null
  const kind = filterGroupKind(value)
  if (!kind) return null
  const nodes = filterNodes(value[kind] ?? [], depth + 1)
  if (!nodes) return null
  return kind === 'all' ? { all: nodes } : { any: nodes }
}

function filterGroupKind(value: Record<string, unknown>) {
  if (Object.hasOwn(value, 'all') === Object.hasOwn(value, 'any')) return null
  return Object.hasOwn(value, 'all') ? 'all' : 'any'
}

function filterNodes(value: unknown, depth: number): MobileViewFilterNode[] | null {
  if (!Array.isArray(value)) return null
  const nodes: MobileViewFilterNode[] = []
  for (const item of value) {
    const node = filterNode(item, depth)
    if (!node) return null
    nodes.push(node)
  }
  return nodes
}

function filterNode(value: unknown, depth: number): MobileViewFilterNode | null {
  if (!isRecord(value)) return null
  if (Object.hasOwn(value, 'all') || Object.hasOwn(value, 'any')) return filterGroup(value, depth)
  const field = optionalText(value.field)
  if (!field || !isFilterOp(value.op)) return null
  return { field, op: value.op, value: value.value, regex: value.regex === true }
}

function isFilterOp(value: unknown): value is MobileViewFilterOp {
  return typeof value === 'string' && filterOps.has(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function textList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map(String)
}
