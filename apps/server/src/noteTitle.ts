import { posix } from 'node:path'
import { frontmatterScalar, parseDocument } from '../../../packages/vault-index/src/frontmatter.ts'
import { stripInlineMarkdown } from '../../../src/utils/inlineMarkdown'
import { splitFrontmatter } from '../../../src/utils/wikilinks'

/**
 * The title the desktop reads from a note (`extract_title` in `src-tauri/src/vault/parsing.rs`):
 * an H1 on the first non-empty line of the body, else the `title` property, else the filename
 * with its hyphens turned into capitalised words. A rename uses it as a wikilink target.
 */

const H1_PREFIX = '# '

function firstNonEmptyLine(text: string): string | null {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed) return trimmed
  }
  return null
}

/** `extract_h1_title`: the H1 text without its inline markdown, or null. */
function h1Title(content: string): string | null {
  const line = firstNonEmptyLine(splitFrontmatter(content)[1])
  if (!line?.startsWith(H1_PREFIX)) return null
  return stripInlineMarkdown(line.slice(H1_PREFIX.length)).trim() || null
}

function propertyTitle(content: string): string | null {
  return frontmatterScalar(parseDocument(content).frontmatter, ['title'])?.trim() || null
}

/** `slug_to_title`: `weekly-review.md` -> `Weekly Review`. */
export function slugToTitle(filename: string): string {
  const stem = filename.replace(/\.md$/, '')
  const words = stem.split('-').filter((word) => word.length > 0)
  return words.map(capitalised).join(' ')
}

/** The first character upper-cased, by code point as in Rust's `char`. */
function capitalised(word: string): string {
  const [first, ...rest] = [...word]
  return first.toUpperCase() + rest.join('')
}

export function noteTitle(content: string, path: string): string {
  return h1Title(content) ?? propertyTitle(content) ?? slugToTitle(posix.basename(path))
}
