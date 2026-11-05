import { posix } from 'node:path'
import { updateFrontmatterContent } from '../../../src/lib/frontmatterText'

/**
 * The wikilink rewrite of a rename, ported from the desktop's `src-tauri/src/vault/rename.rs`
 * so a note renamed on the web leaves the vault exactly as the desktop would:
 *  - the old targets are the note's title, its vault-relative path without `.md` and its
 *    filename without `.md` (`collect_legacy_wikilink_targets`), matched case-sensitively;
 *  - `[[target]]` and `[[target|alias]]` become `[[new/path-stem]]` and
 *    `[[new/path-stem|alias]]` (`build_wikilink_pattern`); `[[target#heading]]` and other
 *    spellings are left alone, as on the desktop;
 *  - raw text everywhere in the file is rewritten, frontmatter included.
 */

/** Text of a note, or of one part of a live document. */
export type NoteText = string
/** What a wikilink points at: a title, or a vault path without `.md`. */
export type LinkTarget = string
/** A vault-relative path. */
type NotePath = string
/** A position in a text, in UTF-16 code units like JavaScript strings and Yjs. */
type Offset = number

/** What a rename rewrites: links to any of `targets` become links to `replacement`. */
export interface LinkRewrite {
  targets: readonly LinkTarget[]
  replacement: LinkTarget
}

/** One rename's rewrite, or the rewrites of every note a folder rename moves, applied in one pass. */
export type LinkRewrites = LinkRewrite | readonly LinkRewrite[]

/** One replacement in a text: `[start, end)` becomes `text`. */
export interface TextEdit {
  start: Offset
  end: Offset
  text: NoteText
}

/** The note being renamed: where it was, where it goes, and the title it had. */
export interface RenamedNote {
  from: NotePath
  to: NotePath
  oldTitle: LinkTarget
}

/** Where the alias of a matching link starts (just after the target) and its `]]` begins. */
interface LinkSpan {
  aliasFrom: Offset
  close: Offset
}

const LINK_OPEN = '[['
const LINK_CLOSE = ']]'
const ALIAS = '|'
const NOTE_EXTENSION = '.md'

/** `projects/weekly-review.md` -> `projects/weekly-review` (`to_path_stem`). */
export function pathStem(path: NotePath): LinkTarget {
  return path.endsWith(NOTE_EXTENSION) ? path.slice(0, -NOTE_EXTENSION.length) : path
}

/** `collect_legacy_wikilink_targets` and the new path stem it rewrites them to. */
export function renameLinkRewrite({ from, to, oldTitle }: RenamedNote): LinkRewrite {
  const oldStem = pathStem(from)
  const candidates = [oldTitle, oldStem, posix.basename(oldStem)]
  const targets = [...new Set(candidates.filter((target) => target.length > 0))]
  return { targets, replacement: pathStem(to) }
}

/** A folder rename's rewrites: each note it moves, linked by its path, follows the folder. */
export function folderLinkRewrites(moves: readonly { from: NotePath; to: NotePath }[]): LinkRewrite[] {
  return moves
    .filter(({ from }) => from.endsWith(NOTE_EXTENSION))
    .map(({ from, to }) => ({ targets: [pathStem(from)], replacement: pathStem(to) }))
}

function rewriteList(rewrites: LinkRewrites): readonly LinkRewrite[] {
  return Array.isArray(rewrites) ? rewrites : [rewrites as LinkRewrite]
}

/** The links of one text that a rename rewrites, found the way the desktop's regex finds them. */
class LinkScan {
  private readonly text: NoteText
  private readonly rewrites: readonly LinkRewrite[]

  constructor(text: NoteText, rewrites: LinkRewrites) {
    this.text = text
    this.rewrites = rewriteList(rewrites)
  }

  /** Left to right and without overlaps: after a match the scan goes on past it. */
  edits(): TextEdit[] {
    const edits: TextEdit[] = []
    let open = this.text.indexOf(LINK_OPEN)
    while (open >= 0) {
      const edit = this.editAt(open)
      if (edit) edits.push(edit)
      open = this.text.indexOf(LINK_OPEN, edit ? edit.end : open + 1)
    }
    return edits
  }

  /** The first target that matches at `open` wins, as with the regex's alternation. */
  private editAt(open: Offset): TextEdit | null {
    for (const rewrite of this.rewrites) {
      const edit = this.rewriteAt(open, rewrite)
      if (edit) return edit
    }
    return null
  }

  private rewriteAt(open: Offset, rewrite: LinkRewrite): TextEdit | null {
    for (const target of rewrite.targets) {
      const span = this.linkTo(open, target)
      if (span) return this.replacement(open, span, rewrite.replacement)
    }
    return null
  }

  private replacement(open: Offset, { aliasFrom, close }: LinkSpan, target: LinkTarget): TextEdit {
    const alias = this.text.slice(aliasFrom, close)
    return { start: open, end: close + LINK_CLOSE.length, text: `${LINK_OPEN}${target}${alias}${LINK_CLOSE}` }
  }

  /** `[[target]]`, or `[[target|alias]]` whose alias holds no `]`. Null for anything else. */
  private linkTo(open: Offset, target: LinkTarget): LinkSpan | null {
    const aliasFrom = open + LINK_OPEN.length + target.length
    if (!this.text.startsWith(target, open + LINK_OPEN.length)) return null
    if (this.text.startsWith(LINK_CLOSE, aliasFrom)) return { aliasFrom, close: aliasFrom }
    if (!this.text.startsWith(ALIAS, aliasFrom)) return null
    const close = this.text.indexOf(']', aliasFrom + 1)
    return close >= 0 && this.text.startsWith(LINK_CLOSE, close) ? { aliasFrom, close } : null
  }
}

/** Every link the rename rewrites in `text`. */
export function linkEdits(text: NoteText, rewrite: LinkRewrites): TextEdit[] {
  return new LinkScan(text, rewrite).edits()
}

/** `text` with the edits applied. */
export function applyEdits(text: NoteText, edits: readonly TextEdit[]): NoteText {
  let result = ''
  let copied = 0
  for (const edit of edits) {
    result += text.slice(copied, edit.start) + edit.text
    copied = edit.end
  }
  return result + text.slice(copied)
}

/** `replace_wikilinks_in_content`: the rewritten text, unchanged when nothing links to the note. */
export function rewriteLinks(text: NoteText, rewrite: LinkRewrites): NoteText {
  return applyEdits(text, linkEdits(text, rewrite))
}

/**
 * `update_note_title_in_content`: the note with its `title` property set, created when absent.
 * Content whose frontmatter cannot be edited safely is kept as it is, as on the desktop.
 */
export function withTitle(content: NoteText, title: LinkTarget): NoteText {
  try {
    return updateFrontmatterContent(content, 'title', title)
  } catch {
    return content
  }
}
