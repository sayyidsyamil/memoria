import git, { type TreeEntry } from 'isomorphic-git'
import type { GitVaultContext } from './gitVault'
import { conflictCopyName, type SyncConflictChoices, type SyncConflictFile } from '../syncConflictModel'
import { conflictVersion, mergeConflictBlobs } from './gitConflictBlobs'

type TreeState = { context: GitVaultContext; choices: SyncConflictChoices; files: SyncConflictFile[] }
type Entries = [TreeEntry | undefined, TreeEntry | undefined, TreeEntry | undefined]

export async function composeConflictTree(context: GitVaultContext, refs: string[], choices: SyncConflictChoices = {}) {
  const state: TreeState = { context, choices, files: [] }
  const oid = await composeTree(state, '', refs)
  return { oid, files: state.files }
}

async function composeTree(state: TreeState, parent: string, refs: (string | undefined)[]): Promise<string> {
  if (parent.split('/').length > 128) throw new Error('invalidConflictPath')
  const trees = []
  for (const oid of refs) trees.push(oid ? (await git.readTree({ ...state.context, oid })).tree : [])
  const names = new Set(trees.flatMap(tree => tree.map(entry => entry.path)))
  const occupied = new Set(names)
  const result: TreeEntry[] = []
  for (const name of [...names].sort()) {
    requireEntryName(name)
    const entries: Entries = [trees[0].find(e => e.path === name), trees[1].find(e => e.path === name), trees[2].find(e => e.path === name)]
    result.push(...await composeEntry(state, parent + name, entries, occupied))
  }
  return git.writeTree({ ...state.context, tree: result })
}

async function composeEntry(state: TreeState, path: string, entries: Entries, occupied: Set<string>): Promise<TreeEntry[]> {
  const [local, base, remote] = entries
  if (same(local, remote) || same(remote, base)) return present(local)
  if (same(local, base)) return present(remote)
  if (canRecurse(entries) && local) {
    const oid = await composeTree(state, `${path}/`, entries.map(entry => entry?.oid))
    return [{ ...local, oid }]
  }
  const merged = await mergeConflictBlobs(state.context, path, entries)
  if (merged) return present(local).map(entry => ({ ...entry, oid: merged }))
  return chooseConflict(state, path, entries, occupied)
}

async function chooseConflict(state: TreeState, path: string, [local, , remote]: Entries, occupied: Set<string>) {
  state.files.push({ path, local: await conflictVersion(state.context, local), remote: await conflictVersion(state.context, remote) })
  const choice = Object.hasOwn(state.choices, path) ? state.choices[path] : undefined
  if (choice === 'remote') return present(remote)
  if (choice === 'both' && local && remote) return [local, { ...remote, path: conflictCopyName(remote.path, occupied) }]
  return localChoiceEntries(local, remote, choice)
}

function localChoiceEntries(local: TreeEntry | undefined, remote: TreeEntry | undefined, choice: SyncConflictChoices[string] | undefined) {
  return present(local ?? (choice === 'both' ? remote : undefined))
}

function same(left: TreeEntry | undefined, right: TreeEntry | undefined) {
  if (!left || !right) return left === right
  return left.oid === right.oid && left.mode === right.mode && left.type === right.type
}

function canRecurse([local, base, remote]: Entries) {
  if (!local || !remote) return false
  return [local, remote, base].every(entry => !entry || entry.type === 'tree')
}

function present(entry: TreeEntry | undefined) { return entry ? [entry] : [] }

function requireEntryName(name: string) {
  if (!name || ['.', '..', '.git'].includes(name.toLowerCase()) || ['/', '\\', '\0'].some(character => name.includes(character))) throw new Error('invalidConflictPath')
}
