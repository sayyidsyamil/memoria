type IndexGeneration = { dirtyPaths: Set<string> }

const activeIndexes = new Map<string, Set<IndexGeneration>>()

export function trackWorkspacePathWrites(root: string, paths: string[]) {
  for (const index of activeIndexes.get(root) ?? []) {
    for (const path of paths) index.dirtyPaths.add(path)
  }
}

export function beginWorkspacePathIndex(root: string) {
  const index: IndexGeneration = { dirtyPaths: new Set() }
  const indexes = activeIndexes.get(root) ?? new Set<IndexGeneration>()
  indexes.add(index)
  activeIndexes.set(root, indexes)
  return {
    takeChangedPaths: () => {
      const paths = [...index.dirtyPaths]
      index.dirtyPaths.clear()
      return paths
    },
    finish: () => {
      indexes.delete(index)
      if (indexes.size === 0) activeIndexes.delete(root)
    },
  }
}
