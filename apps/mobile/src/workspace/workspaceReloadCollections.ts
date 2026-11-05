import { mapWorkspaceItems } from './cooperativeWorkspaceItems'

/** Three-way merge for immutable workspace collections, retaining the current order. */
export async function mergeReloadCollection<Value>(input: {
  baseline: ReadonlyMap<string, Value>
  current: ReadonlyMap<string, Value>
  fresh: ReadonlyMap<string, Value>
  changed?: (before: Value, after: Value) => boolean
  signal?: AbortSignal
}) {
  const { baseline, current, fresh, changed = (before, after) => before !== after } = input
  const result = new Map<string, Value>()
  await mapWorkspaceItems([...current], ([key, value]) => {
    const before = baseline.get(key)
    const scanned = fresh.get(key)
    if (before === undefined || changed(before, value)) result.set(key, value)
    else if (scanned !== undefined) result.set(key, scanned)
  }, input.signal)
  await mapWorkspaceItems([...fresh], ([key, value]) => {
    if (!baseline.has(key) && !result.has(key)) result.set(key, value)
  }, input.signal)
  return result
}

export async function mergeReloadRecord<Value>(input: {
  baseline?: Record<string, Value>
  current?: Record<string, Value>
  fresh?: Record<string, Value>
  signal?: AbortSignal
}) {
  return Object.fromEntries(await mergeReloadCollection({
    baseline: new Map(Object.entries(input.baseline ?? {})),
    current: new Map(Object.entries(input.current ?? {})),
    fresh: new Map(Object.entries(input.fresh ?? {})),
    signal: input.signal,
  }))
}

export function mergeReloadFolders(input: { baseline?: string[]; current?: string[]; fresh?: string[] }) {
  const baseline = new Set(input.baseline)
  const current = new Set(input.current)
  const removed = new Set([...baseline].filter(path => !current.has(path)))
  const result = new Set(current)
  for (const path of input.fresh ?? []) {
    if (!insideRemovedFolder(path, removed)) result.add(path)
  }
  // An unchanged directory can have disappeared externally since the scan baseline.
  const fresh = new Set(input.fresh)
  for (const path of baseline) if (!fresh.has(path)) result.delete(path)
  return [...result]
}

function insideRemovedFolder(path: string, removed: Set<string>) {
  let parent = path
  while (parent) {
    if (removed.has(parent)) return true
    const separator = parent.lastIndexOf('/')
    parent = separator < 0 ? '' : parent.slice(0, separator)
  }
  return false
}
