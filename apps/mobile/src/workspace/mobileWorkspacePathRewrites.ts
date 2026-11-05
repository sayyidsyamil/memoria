import type { MobileNote } from './mobileWorkspaceModel'

type MarkdownContent = string
type NotePath = string
type WikilinkTarget = string

export type MovedNoteWikilinkRewrite = {
  newTarget: WikilinkTarget
  oldTargets: Set<WikilinkTarget>
  targetRewrites: Map<WikilinkTarget, WikilinkTarget>
}

export function noteWritePath(note: MobileNote): NotePath {
  return note.path ?? note.id
}

export function noteWithWritePath(note: MobileNote, nextPath: NotePath): MobileNote {
  const previousPath = noteWritePath(note)
  if (nextPath === previousPath) return note

  return {
    ...note,
    id: note.id === previousPath ? nextPath : note.id,
    path: nextPath,
  }
}

export function movedNoteWikilinkRewrite(
  previousNote: MobileNote,
  nextNote: MobileNote,
): MovedNoteWikilinkRewrite {
  const newTarget = notePathStem(noteWritePath(nextNote))
  const targetRewrites = movedNoteTargetRewrites(previousNote, newTarget)

  return {
    newTarget,
    oldTargets: new Set(targetRewrites.keys()),
    targetRewrites,
  }
}

export function rewriteMovedNoteWikilinks(
  note: MobileNote,
  rewrite: MovedNoteWikilinkRewrite,
): MobileNote {
  if (note.rawContent === undefined) return note

  const rawContent = rewriteMovedWikilinkContent(note.rawContent, rewrite)
  return rawContent === note.rawContent ? note : { ...note, rawContent }
}

export function rewriteMovedWikilinkContent(
  content: MarkdownContent,
  rewrite: MovedNoteWikilinkRewrite,
): MarkdownContent {
  return replaceMovedWikilinks(content, rewrite)
}

export function noteFilename(path: NotePath): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

function replaceMovedWikilinks(
  content: MarkdownContent,
  rewrite: MovedNoteWikilinkRewrite,
): MarkdownContent {
  return content.replace(/\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, (match, target: string, alias: string | undefined) => {
    const nextTarget = rewrite.targetRewrites.get(target.trim())
      ?? (rewrite.oldTargets.has(target.trim()) ? rewrite.newTarget : null)
    return nextTarget ? `[[${nextTarget}${alias ?? ''}]]` : match
  })
}

function notePathStem(path: NotePath): string {
  return path.replace(/\.md$/u, '')
}

function movedNoteTargetRewrites(
  previousNote: MobileNote,
  newTarget: WikilinkTarget,
): Map<WikilinkTarget, WikilinkTarget> {
  const rewrites = new Map(localMovedNoteTargets(previousNote).map((target) => [target, newTarget]))
  const workspaceAliases = workspaceAliasTargets(previousNote)
  if (workspaceAliases.length === 0) return rewrites

  for (const target of localMovedNoteTargets(previousNote)) {
    for (const workspaceAlias of workspaceAliases) {
      rewrites.set(`${workspaceAlias}/${target}`, `${workspaceAlias}/${newTarget}`)
    }
  }

  return rewrites
}

function workspaceAliasTargets(note: MobileNote): WikilinkTarget[] {
  const workspaceAlias = note.workspaceAlias?.trim()
  if (!workspaceAlias) return []

  return [...new Set([workspaceAlias, workspaceAlias.toLowerCase()])]
}

function localMovedNoteTargets(note: MobileNote): WikilinkTarget[] {
  return [...new Set([
    note.title,
    notePathStem(noteWritePath(note)),
    noteWritePath(note),
    noteFilename(noteWritePath(note)).replace(/\.md$/u, ''),
    noteFilename(noteWritePath(note)),
  ].filter(Boolean))]
}
