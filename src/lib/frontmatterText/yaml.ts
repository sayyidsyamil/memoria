import { assertBlockLines, assertKey, assertPlainScalar, assertQuotable, assertSingleLine } from './unsafeText'

/**
 * YAML formatting of the desktop writer (`src-tauri/src/frontmatter/yaml.rs`), ported as is
 * so a property written on the web has the bytes the desktop would write. Keep the two in step.
 * Escaping is the desktop's (only `"`, inside `"…"`), so text it would not write back intact
 * is refused with `UnsafeFrontmatterEditError` (see `unsafeText.ts`).
 */

/** What a property can be set to: the shape the desktop `FrontmatterValue` accepts. */
export type FrontmatterTextValue = string | number | boolean | string[] | null

/** A string value or key as the user typed it, before YAML formatting. */
type PlainText = string
/** Text formatted for a YAML frontmatter line. */
type YamlText = string

const SPECIAL_FLOATS = new Set(['inf', 'infinity', 'nan'])
/** Only ASCII digits, or nothing. */
function isDigits(text: PlainText): boolean {
  return [...text].every(char => char >= '0' && char <= '9')
}

function withoutSign(text: PlainText): PlainText {
  return text.startsWith('+') || text.startsWith('-') ? text.slice(1) : text
}

/** Digits with at most one `.`, and at least one digit: `1`, `1.`, `.5`, `1.5`. */
function isDecimal(text: PlainText): boolean {
  const [whole = '', fraction = '', ...more] = text.split('.')
  return more.length === 0 && isDigits(whole) && isDigits(fraction) && `${whole}${fraction}` !== ''
}

function isExponent(text: PlainText | undefined): boolean {
  if (text === undefined) return true
  const digits = withoutSign(text)
  return digits !== '' && isDigits(digits)
}

/** Rust's `str::parse::<f64>` grammar: no whitespace, no hex, an optional exponent, inf and NaN. */
function isRustFloat(text: PlainText): boolean {
  const unsigned = withoutSign(text)
  if (SPECIAL_FLOATS.has(unsigned.toLowerCase())) return true
  const [mantissa = '', exponent, ...more] = unsigned.toLowerCase().split('e')
  return more.length === 0 && isDecimal(mantissa) && isExponent(exponent)
}

const YAML_KEYWORDS = new Set(['true', 'false', 'null'])

const QUOTING_RULES: readonly ((text: PlainText) => boolean)[] = [
  text => text.includes(':') || text.includes('#'),
  text => text.startsWith('[') || text.startsWith('{'),
  text => YAML_KEYWORDS.has(text),
  isRustFloat,
]

/** True when the desktop writes this single-line string value in double quotes. */
export function needsQuoting(text: PlainText): boolean {
  return QUOTING_RULES.some(rule => rule(text))
}

function quoted(text: PlainText): YamlText {
  return `"${assertQuotable(text).replaceAll('"', '\\"')}"`
}

/** Rust's `str::lines`: split on `\n`, drop one trailing `\r` per line and a final empty line. */
export function rustLines(text: PlainText): PlainText[] {
  const lines = text.split('\n').map(line => (line.endsWith('\r') ? line.slice(0, -1) : line))
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function blockScalar(text: PlainText): YamlText {
  return `|\n${assertBlockLines(rustLines(text)).map(line => (line === '' ? '' : `  ${line}`)).join('\n')}`
}

/** True when the desktop writes this key in double quotes. */
export function needsKeyQuoting(key: PlainText): boolean {
  return /[^A-Za-z0-9_-]/.test(key)
}

export function formatYamlKey(key: PlainText): YamlText {
  if (needsKeyQuoting(assertKey(key))) return quoted(key)
  return assertSingleLine(key)
}

const I64_MAX = 9223372036854775807n
const I64_MIN = -9223372036854775808n

/** Rust's saturating `n as i64`, printed. */
function integerText(value: number): YamlText {
  if (value >= 2 ** 63) return I64_MAX.toString()
  if (value < -(2 ** 63)) return I64_MIN.toString()
  return BigInt(value).toString()
}

/** Rust's `{}` for a fractional f64: the shortest round-trip digits, never in exponent form. */
function fractionText(value: number): YamlText {
  const text = String(value)
  const [mantissa = '', power] = text.split('e-')
  if (power === undefined) return text
  const sign = mantissa.startsWith('-') ? '-' : ''
  const digits = withoutSign(mantissa).replace('.', '')
  return `${sign}0.${'0'.repeat(Number(power) - 1)}${digits}`
}

/** Rust's `{}` for NaN and the infinities. */
function nonFiniteText(value: number): YamlText {
  if (Number.isNaN(value)) return 'NaN'
  return value > 0 ? 'inf' : '-inf'
}

function formatYamlNumber(value: number): YamlText {
  if (!Number.isFinite(value)) return nonFiniteText(value)
  return Number.isInteger(value) ? integerText(value) : fractionText(value)
}

function formatYamlString(text: PlainText): YamlText {
  if (text.includes('\n')) return blockScalar(text)
  return needsQuoting(text) ? quoted(text) : assertPlainScalar(text)
}

function formatYamlList(items: readonly PlainText[]): YamlText {
  if (items.length === 0) return '[]'
  return items.map(item => `  - ${quoted(item)}`).join('\n')
}

export function toYamlValue(value: FrontmatterTextValue): YamlText {
  if (value === null) return 'null'
  if (Array.isArray(value)) return formatYamlList(value)
  if (typeof value === 'number') return formatYamlNumber(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return formatYamlString(value)
}

function isNonEmptyList(value: FrontmatterTextValue): value is string[] {
  return Array.isArray(value) && value.length > 0
}

/**
 * A key and its value as YAML lines: a non-empty list's items go on the line after the key.
 * A list's items and a block scalar's lines stay joined by `\n`, as on the desktop.
 */
export function formatYamlField(key: PlainText, value: FrontmatterTextValue): YamlText[] {
  const yamlKey = formatYamlKey(key)
  const yamlValue = toYamlValue(value)
  return isNonEmptyList(value) ? [`${yamlKey}:`, yamlValue] : [`${yamlKey}: ${yamlValue}`]
}
