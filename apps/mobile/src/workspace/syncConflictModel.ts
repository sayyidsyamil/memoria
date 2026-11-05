export type SyncConflictChoice = 'local' | 'remote' | 'both'
export type SyncConflictChoices = Record<string, SyncConflictChoice>
export type SyncConflictVersion = { kind: 'text' | 'binary' | 'deleted'; text: string; truncated: boolean }
export type SyncConflictFile = { path: string; local: SyncConflictVersion; remote: SyncConflictVersion }

export function completeConflictChoices(files: { path: string }[], choices: SyncConflictChoices) {
  return files.every(file => Object.hasOwn(choices, file.path) && ['local', 'remote', 'both'].includes(choices[file.path]))
}

export function conflictCopyName(name: string, occupied: Set<string>) {
  const extension = name.lastIndexOf('.')
  const stem = extension > 0 ? name.slice(0, extension) : name
  const suffix = extension > 0 ? name.slice(extension) : ''
  for (let index = 1; ; index += 1) {
    const path = `${stem} (conflict ${index})${suffix}`
    if (!occupied.has(path)) { occupied.add(path); return path }
  }
}
