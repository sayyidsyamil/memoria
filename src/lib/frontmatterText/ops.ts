import { frontmatterKeyRule, frontmatterKeysMatch, rustTrim, rustTrimStart } from './keys'
import { assertSafeFrontmatterEdit } from './safety'
import { type FrontmatterTextValue, formatYamlField } from './yaml'

/**
 * Property writes on a note's text, ported from the desktop writer
 * (`src-tauri/src/frontmatter/ops.rs`): the same lines change, in the same place, with the
 * same bytes, and everything else in the file is left as it was. Golden cases shared with
 * the Rust tests live in `tests/fixtures/frontmatter-ops/`. Keep the two in step.
 */

type KeyMatchMode = 'exact' | 'canonical'
/** A note's text: frontmatter and body, or only its frontmatter block. */
type NoteText = string
/** One line of a frontmatter block, without its line break. */
type FrontmatterLine = string
type FrontmatterKey = string
type LineEnding = string

interface FieldUpdate {
  key: FrontmatterKey
  /** `undefined` deletes the key. */
  value: FrontmatterTextValue | undefined
  matchMode: KeyMatchMode
}

interface FrontmatterBlock {
  body: NoteText
  /** Everything after the closing delimiter, starting with its line break. */
  rest: NoteText
  lineEnding: LineEnding
}

export class MalformedFrontmatterError extends Error {
  constructor() {
    super('Malformed frontmatter: no closing ---')
    this.name = 'MalformedFrontmatterError'
  }
}

const LINE_BREAK_CHAR = /[\r\n]/g

function lineEnd(content: NoteText, start: number): number {
  LINE_BREAK_CHAR.lastIndex = start
  return LINE_BREAK_CHAR.exec(content)?.index ?? content.length
}

function lineBreak(content: NoteText, index: number): [LineEnding, number] | null {
  if (content.startsWith('\r\n', index)) return ['\r\n', 2]
  const char = content.charAt(index)
  return char === '\n' || char === '\r' ? [char, 1] : null
}

function isFrontmatterDelimiter(line: FrontmatterLine): boolean {
  return /^---[ \t]*$/.test(line)
}

function frontmatterOpen(content: NoteText): [number, LineEnding] | null {
  const openingEnd = lineEnd(content, 0)
  if (!isFrontmatterDelimiter(content.slice(0, openingEnd))) return null
  const opening = lineBreak(content, openingEnd)
  return opening ? [openingEnd + opening[1], opening[0]] : null
}

function splitFrontmatterBlock(content: NoteText): FrontmatterBlock | null {
  const open = frontmatterOpen(content)
  if (!open) return null
  const [bodyStart, lineEnding] = open
  let lineStart = bodyStart
  while (lineStart < content.length) {
    const currentLineEnd = lineEnd(content, lineStart)
    if (isFrontmatterDelimiter(content.slice(lineStart, currentLineEnd))) {
      return { body: content.slice(bodyStart, lineStart), rest: content.slice(currentLineEnd), lineEnding }
    }
    const next = lineBreak(content, currentLineEnd)
    if (!next) break
    lineStart = currentLineEnd + next[1]
  }
  throw new MalformedFrontmatterError()
}

/** Rust's `split_terminator`: like `split`, without the empty piece after a final separator. */
function splitTerminator(text: NoteText, separator: LineEnding): FrontmatterLine[] {
  const pieces = text.split(separator)
  if (pieces.at(-1) === '') pieces.pop()
  return pieces
}

function quotedYamlKey(raw: FrontmatterLine, quote: '"' | "'"): FrontmatterKey | null {
  const end = raw.indexOf(quote)
  if (end === -1) return null
  return rustTrimStart(raw.slice(end + 1)).startsWith(':') ? raw.slice(0, end) : null
}

/** The key a frontmatter line sets, read the way the desktop reads it (indented lines too). */
function lineKey(line: FrontmatterLine): FrontmatterKey | null {
  const trimmed = rustTrimStart(line)
  if (trimmed.startsWith('"')) return quotedYamlKey(trimmed.slice(1), '"')
  if (trimmed.startsWith("'")) return quotedYamlKey(trimmed.slice(1), "'")
  const colon = trimmed.indexOf(':')
  const key = colon === -1 ? '' : rustTrim(trimmed.slice(0, colon))
  return key === '' ? null : key
}

/** A line that continues the previous key's value: a list item, block scalar content, or blank. */
function isValueContinuation(line: FrontmatterLine): boolean {
  return line === '' || line.startsWith('  ') || line.startsWith('\t')
}

function matchesLine(update: FieldUpdate, line: FrontmatterLine): boolean {
  const candidate = lineKey(line)
  if (candidate === null) return false
  return update.matchMode === 'exact' ? candidate === update.key : frontmatterKeysMatch(candidate, update.key)
}

function skipValue(lines: readonly FrontmatterLine[], start: number): number {
  let next = start
  while (next < lines.length && isValueContinuation(lines.at(next) ?? '')) next++
  return next
}

function applyToLines(update: FieldUpdate, lines: readonly FrontmatterLine[]): FrontmatterLine[] {
  const updated: FrontmatterLine[] = []
  let found = false
  let index = 0
  while (index < lines.length) {
    const line = lines.at(index) ?? ''
    if (!matchesLine(update, line)) {
      updated.push(line)
      index++
      continue
    }
    found = true
    index = skipValue(lines, index + 1)
    if (update.value !== undefined) updated.push(...formatYamlField(update.key, update.value))
  }
  if (!found && update.value !== undefined) updated.push(...formatYamlField(update.key, update.value))
  return updated
}

function applyToContent(update: FieldUpdate, content: NoteText): NoteText {
  const block = splitFrontmatterBlock(content)
  if (!block) {
    if (update.value === undefined) return content
    return `---\n${formatYamlField(update.key, update.value).join('\n')}\n---\n${content}`
  }
  const lines = splitTerminator(block.body, block.lineEnding)
  const frontmatter = applyToLines(update, lines).join(block.lineEnding)
  return `---${block.lineEnding}${frontmatter}${block.lineEnding}---${block.rest}`
}

/**
 * Sets `key` to `value` in the note's frontmatter, or deletes it when `value` is `undefined`:
 * `update_frontmatter_content` of the desktop. Throws `MalformedFrontmatterError` when the
 * frontmatter has no closing delimiter, and `UnsafeFrontmatterEditError` for a key or value
 * the desktop would write as YAML that does not read back as written.
 */
export function updateFrontmatterContent(
  content: NoteText,
  key: FrontmatterKey,
  value: FrontmatterTextValue | undefined,
): NoteText {
  assertSafeFrontmatterEdit(key, value)
  const rule = frontmatterKeyRule(key)
  if (!rule?.canonicalizeOnWrite) return applyToContent({ key, value, matchMode: 'exact' }, content)
  const withoutAliases = applyToContent({ key: rule.writeKey, value: undefined, matchMode: 'canonical' }, content)
  return applyToContent({ key: rule.writeKey, value, matchMode: 'exact' }, withoutAliases)
}
