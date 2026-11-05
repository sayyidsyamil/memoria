/**
 * The frontmatter key table of the desktop writer (`src-tauri/src/frontmatter/keys.rs`),
 * ported as is so the web writes the same keys. Keep the two in step.
 */

export interface FrontmatterKeyRule {
  readKey: string
  writeKey: string
  aliases: readonly string[]
  canonicalizeOnWrite: boolean
}

function rule(key: string, aliases: readonly string[], canonicalizeOnWrite = false): FrontmatterKeyRule {
  return { readKey: key, writeKey: key, aliases, canonicalizeOnWrite }
}

const KNOWN_FRONTMATTER_KEYS: readonly FrontmatterKeyRule[] = [
  rule('title', ['title']),
  rule('type', ['type', 'is_a', 'Is A'], true),
  rule('aliases', ['aliases']),
  rule('_archived', ['_archived', 'Archived', 'archived'], true),
  rule('Status', ['Status', 'status']),
  rule('_icon', ['_icon', 'icon'], true),
  rule('color', ['color', '_color']),
  rule('_order', ['_order', 'order'], true),
  rule('_sidebar_label', ['_sidebar_label', 'sidebar_label', 'sidebar label'], true),
  rule('_pinned_properties', ['_pinned_properties']),
  rule('template', ['template']),
  rule('_sort', ['_sort', 'sort'], true),
  rule('view', ['view']),
  rule('_width', ['_width', 'width'], true),
  rule('_display', ['_display']),
  rule('visible', ['visible']),
  rule('_organized', ['_organized']),
  rule('_favorite', ['_favorite']),
  rule('_favorite_index', ['_favorite_index']),
  rule('_list_properties_display', ['_list_properties_display']),
]

/** Rust's `to_ascii_lowercase`: only ASCII letters change case. */
function asciiLowercase(text: string): string {
  return text.replace(/[A-Z]/g, letter => letter.toLowerCase())
}

const WHITE_SPACE = /^\p{White_Space}$/u

function isRustWhiteSpace(char: string): boolean {
  return WHITE_SPACE.test(char)
}

/** Rust's `str::trim_start`: Unicode White_Space (not U+FEFF, unlike JS `trimStart`). */
export function rustTrimStart(text: string): string {
  let start = 0
  while (isRustWhiteSpace(text.charAt(start))) start++
  return text.slice(start)
}

/** Rust's `str::trim`. */
export function rustTrim(text: string): string {
  const trimmed = rustTrimStart(text)
  let end = trimmed.length
  while (end > 0 && isRustWhiteSpace(trimmed.charAt(end - 1))) end--
  return trimmed.slice(0, end)
}

export function normalizedFrontmatterKey(key: string): string {
  return asciiLowercase(rustTrim(key)).replaceAll(' ', '_')
}

export function frontmatterKeyRule(key: string): FrontmatterKeyRule | undefined {
  const normalized = normalizedFrontmatterKey(key)
  return KNOWN_FRONTMATTER_KEYS.find(known =>
    known.aliases.some(alias => normalizedFrontmatterKey(alias) === normalized))
}

export function frontmatterKeysMatch(left: string, right: string): boolean {
  const leftRule = frontmatterKeyRule(left)
  const rightRule = frontmatterKeyRule(right)
  if (leftRule && rightRule) return leftRule.readKey === rightRule.readKey
  return normalizedFrontmatterKey(left) === normalizedFrontmatterKey(right)
}
