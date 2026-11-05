/**
 * Text the desktop frontmatter writer cannot write so that it reads back as written. It
 * quotes with `"` escaping only `"`, and writes all other text as is: a backslash in quoted
 * text becomes an escape sequence, and a line break or control character in a single-line
 * position ends the line early and can start a key of its own; an unquoted value that starts
 * with a YAML indicator, or is a YAML 1.2 null, boolean or number the desktop does not quote,
 * reads back as structure or as another type. The web port refuses such text instead of
 * writing different bytes from the desktop's.
 */

type PlainText = string

export class UnsafeFrontmatterEditError extends Error {
  constructor() {
    super('This property cannot be written to frontmatter safely')
    this.name = 'UnsafeFrontmatterEditError'
  }
}

const TAB = 0x09
const DELETE = 0x7f
/** NEL, LINE SEPARATOR and PARAGRAPH SEPARATOR: line breaks to YAML 1.1. */
const UNICODE_LINE_BREAKS = new Set([0x85, 0x2028, 0x2029])

/** C0 controls other than tab (so `\n` and `\r` too), and DEL. */
function isControl(code: number): boolean {
  return code < 0x20 ? code !== TAB : code === DELETE
}

function breaksLine(code: number): boolean {
  return isControl(code) || UNICODE_LINE_BREAKS.has(code)
}

function breaksSingleLine(text: PlainText): boolean {
  return [...text].some(char => breaksLine(char.charCodeAt(0)))
}

/** Text written on one line as is: a plain scalar or key, or a line of a block scalar. */
export function assertSingleLine(text: PlainText): PlainText {
  if (breaksSingleLine(text)) throw new UnsafeFrontmatterEditError()
  return text
}

/** Characters that make an unquoted value an alias, anchor, tag, block scalar or quoted text. */
const INDICATORS = new Set(['!', '&', '*', '|', '>', "'", '"', '%', '@', '`'])
/** YAML 1.2 core schema nulls, booleans and special floats the desktop leaves unquoted. */
const CORE_SCHEMA_WORDS = new Set(['~', 'Null', 'NULL', 'True', 'TRUE', 'False', 'FALSE', '.nan', '.NaN', '.NAN'])
const CORE_SCHEMA_INFINITIES = new Set(['.inf', '.Inf', '.INF'])
const CORE_SCHEMA_INTEGERS = [/^0x[\dA-Fa-f]+$/, /^0o[0-7]+$/]

/** `-` or `?` alone or before a space: a block sequence entry or a complex key. */
function isBlockIndicator(text: PlainText): boolean {
  return ['-', '?'].includes(text.charAt(0)) && [' ', ''].includes(text.charAt(1))
}

function startsStructure(text: PlainText): boolean {
  return INDICATORS.has(text.charAt(0)) || isBlockIndicator(text)
}

function isSignedInfinity(text: PlainText): boolean {
  const unsigned = ['+', '-'].includes(text.charAt(0)) ? text.slice(1) : text
  return CORE_SCHEMA_INFINITIES.has(unsigned)
}

function readsAsAnotherType(text: PlainText): boolean {
  return CORE_SCHEMA_WORDS.has(text)
    || isSignedInfinity(text)
    || CORE_SCHEMA_INTEGERS.some(pattern => pattern.test(text))
}

/** A string value written without quotes: one line that reads back as the same string. */
export function assertPlainScalar(text: PlainText): PlainText {
  if (startsStructure(text) || readsAsAnotherType(text)) throw new UnsafeFrontmatterEditError()
  return assertSingleLine(text)
}

/** A property key: not empty, since `: value` is not a property. */
export function assertKey(key: PlainText): PlainText {
  if (key === '') throw new UnsafeFrontmatterEditError()
  return key
}

/** Text written inside `"…"` with only `"` escaped. */
export function assertQuotable(text: PlainText): PlainText {
  if (text.includes('\\')) throw new UnsafeFrontmatterEditError()
  return assertSingleLine(text)
}

/**
 * The lines of a block scalar, each indented under the key: none may break, and the first
 * one may not start with a space, which would change the indentation YAML reads.
 */
export function assertBlockLines(lines: readonly PlainText[]): readonly PlainText[] {
  const first = lines.find(line => line !== '') ?? ''
  if (first.startsWith(' ')) throw new UnsafeFrontmatterEditError()
  lines.forEach(assertSingleLine)
  return lines
}
