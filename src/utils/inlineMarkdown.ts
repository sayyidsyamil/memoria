const INLINE_MARKDOWN_PATTERNS = [
  /~~(\S[^~]*\S|\S)~~/gu,
  /\[([^\]]+)\]\([^)]+\)/gu,
  /\[\[[^|\]]+\|([^\]]+)\]\]/gu,
  /\[\[([^\]]+)\]\]/gu,
  /\[\[([^\]]*)$/gu,
]
const LETTER_OR_NUMBER_PATTERN = /[\p{L}\p{N}]/u

function isLetterOrNumber(value: string | undefined): boolean {
  return value !== undefined && LETTER_OR_NUMBER_PATTERN.test(value)
}

function isEscapableInlineMarker(value: string | undefined): boolean {
  return value === '*' || value === '_' || value === '`'
}

function shouldRemoveInlineMarker(
  character: string | undefined,
  previousCharacter: string | undefined,
  nextCharacter: string | undefined,
): boolean {
  if (character === '*' || character === '`') return true
  if (character !== '_') return false
  return !isLetterOrNumber(previousCharacter) || !isLetterOrNumber(nextCharacter)
}

function nextCharacter(iterator: ArrayIterator<string>): string | undefined {
  const result = iterator.next()
  return result.done ? undefined : result.value
}

function stripInlineMarkers(text: string): string {
  const iterator = Array.from(text).values()
  let result = ''
  let previousCharacter: string | undefined
  let character = nextCharacter(iterator)
  let followingCharacter = nextCharacter(iterator)

  while (character !== undefined) {
    if (character === '\\' && isEscapableInlineMarker(followingCharacter)) {
      result += followingCharacter
      previousCharacter = followingCharacter
      character = nextCharacter(iterator)
      followingCharacter = nextCharacter(iterator)
      continue
    }
    if (!shouldRemoveInlineMarker(character, previousCharacter, followingCharacter)) result += character
    previousCharacter = character
    character = followingCharacter
    followingCharacter = nextCharacter(iterator)
  }

  return result
}

export function stripInlineMarkdown(text: string): string {
  const withoutLinks = INLINE_MARKDOWN_PATTERNS.reduce(
    (result, pattern) => result.replace(pattern, '$1'),
    text,
  )
  return stripInlineMarkers(withoutLinks).trim()
}

// A link or image: [text](address), [text](<address with spaces>), optionally with a title, and also a link that a
// shortened snippet cut off before its closing bracket: "[Open original](<attachments/transcript-…".
const SNIPPET_LINK_PATTERN = /!?\[([^\]\n]*)\]\((?:<[^>\n]*>?|[^)\s]*)(?:\s+"[^"\n]*")?\)?/gu
const SNIPPET_WIKILINK_PATTERNS = [/\[\[[^|\]\n]+\|([^\]\n]+)\]\]/gu, /\[\[([^\]\n]+)\]\]/gu]
// The vault index cuts a preview at 160 bytes, often inside a word, and marks the cut with "...".
const INDEX_CUT = { bytes: 160, marker: '...' }

/**
 * A note preview as people read it: the words of a link, never its syntax or file address. The vault index already strips
 * links it can see whole; this also covers previews from other sources and links cut off by shortening. A preview the
 * index cut short ends on a whole word, with an ellipsis.
 */
export function readableSnippet(text: string): string {
  const cut = text.endsWith(INDEX_CUT.marker) && new TextEncoder().encode(text).length >= INDEX_CUT.bytes
  let source = cut ? text.slice(0, -INDEX_CUT.marker.length) : text
  // A cut in the words leaves part of a word, which is dropped; a cut inside a link's address leaves its words whole.
  if (cut && !/\]\([^)\n]*$/u.test(source)) source = source.replace(/\s+\S*$/u, '') || source
  const withoutWikilinks = SNIPPET_WIKILINK_PATTERNS.reduce((result, pattern) => result.replace(pattern, '$1'), source)
  const readable = withoutWikilinks.replace(SNIPPET_LINK_PATTERN, '$1').replace(/[ \t]{2,}/g, ' ').trim()
  return cut ? `${readable.replace(/[\s,;:]+$/u, '')}…` : readable
}
