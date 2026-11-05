import { splitFrontmatter } from '../../../src/utils/wikilinks'
import { type Lines, type MergeChunk, merge3 } from './lineMerge.ts'

/**
 * Writing a note back must not reformat what nobody edited: the serializer normalises
 * markdown (blank lines, escapes, the trailing newline), and a file rewritten in that form
 * shows a git diff for lines the user never touched. So an edit is carried over to the
 * original bytes instead: the lines that differ between the serialized source and the
 * serialized document are the edit, and only those replace lines of the source file.
 *
 * The blank lines between the frontmatter and the body and the line breaks after the body
 * are the file's layout, not lines of the body: the serializer drops the first and ends the
 * body with exactly one line break. They are taken off before the merge, so an edit at the
 * top or the end of the body cannot land on the wrong side of them, and put back after it.
 */

export interface SourceVersions {
  /** The bytes of the file the document was loaded from. */
  source: string
  /** The serializer's rendering of that file, before any edit. */
  canonicalSource: string
  /** The serializer's rendering of the document now. */
  canonical: string
}

function lines(text: string): string[] {
  return text.split('\n')
}

function indexOfRun(haystack: Lines, needle: Lines): number {
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((line, offset) => haystack[start + offset] === line)) return start
  }
  return -1
}

/**
 * The source formats these lines differently and the user also edited them. When the source
 * only added lines around them (a blank line after the frontmatter, the final newline), those
 * stay; otherwise the edit wins in the serializer's form.
 */
function editedOverSource(base: Lines, source: Lines, edited: Lines): Lines {
  const start = indexOfRun(source, base)
  if (start < 0) return edited
  return [...source.slice(0, start), ...edited, ...source.slice(start + base.length)]
}

function chunkLines(chunk: MergeChunk): Lines {
  if (chunk.kind === 'conflict') return editedOverSource(chunk.base, chunk.a, chunk.b)
  return chunk.lines
}

/** A note split around its body: `frontmatter + lead + core + tail` is the whole text. */
interface Layout {
  frontmatter: string
  /** Blank lines before the first line of the body. */
  lead: string
  core: string
  /** Line breaks and blank lines after the last line of the body. */
  tail: string
}

function leadOf(body: string): string {
  const space = body.slice(0, body.length - body.trimStart().length)
  return space.slice(0, space.lastIndexOf('\n') + 1)
}

function tailOf(rest: string): string {
  const space = rest.slice(rest.trimEnd().length)
  const lineBreak = space.search(/[\r\n]/)
  return lineBreak < 0 ? '' : space.slice(lineBreak)
}

function layout(markdown: string): Layout {
  const [frontmatter, body] = splitFrontmatter(markdown)
  const lead = leadOf(body)
  const rest = body.slice(lead.length)
  const tail = tailOf(rest)
  return { frontmatter, lead, core: rest.slice(0, rest.length - tail.length), tail }
}

function withoutLayout({ frontmatter, core }: Layout): Lines {
  return lines(frontmatter + core)
}

/** The merged note in the source's layout; a note with no body left is written bare. */
function inSourceLayout(merged: string, { lead, tail }: Layout): string {
  const { frontmatter, core } = layout(merged)
  return core === '' ? merged : frontmatter + lead + core + tail
}

/** The source file with the document's edits applied and every untouched line byte-identical. */
export function preserveSource({ source, canonicalSource, canonical }: SourceVersions): string {
  if (canonical === canonicalSource) return source
  const sourceLayout = layout(source)
  const chunks = merge3(withoutLayout(layout(canonicalSource)), withoutLayout(sourceLayout), withoutLayout(layout(canonical)))
  return inSourceLayout(chunks.flatMap(chunkLines).join('\n'), sourceLayout)
}
