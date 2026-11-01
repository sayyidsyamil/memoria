import type {
  NativeWysiwygPlainTextPayload,
  NativeWysiwygSelection,
  NativeWysiwygWikilinkPayload,
} from '../components/workspace/MobileWysiwygWikilinkBridgeModel'

type MarkdownContent = string
type NoteId = string
type ProbeLogText = string
type ProbeLine = string

export type NativeWysiwygWikilinkInsertProof = {
  contentLength: number
  insertedEmojiSaved: boolean
  insertedEmojiSourceRemoved: boolean
  insertedPersonMentionSaved: boolean
  insertedPersonMentionSourceRemoved: boolean
  insertedWikilinkSaved: boolean
  noteId: NoteId
}

export type NativeWysiwygWikilinkInsertAssertionFailure = {
  id: string
  message: string
}

export const nativeWysiwygWikilinkInsertLogPrefix = 'MEMORIA_MOBILE_WYSIWYG_WIKILINK_INSERT_PROBE'
const probeTarget = 'AI Ops Guide'
const expectedWikilink = `[[${probeTarget}]]`
const personMentionProbeLabel = 'Luca'
const personMentionProbeTarget = 'People/Luca'
const personMentionProbeSource = 'Ask @Lu'
const expectedPersonMentionWikilink = `[[${personMentionProbeTarget}|${personMentionProbeLabel}]]`
const emojiProbeSource = 'Ship :rock'
const emojiProbeShortcode = ':rock'
const expectedEmoji = String.fromCodePoint(0x1F680)
const proofFieldTypes = {
  contentLength: 'number',
  insertedEmojiSaved: 'boolean',
  insertedEmojiSourceRemoved: 'boolean',
  insertedPersonMentionSaved: 'boolean',
  insertedPersonMentionSourceRemoved: 'boolean',
  insertedWikilinkSaved: 'boolean',
  noteId: 'string',
} as const

export function nativeWysiwygWikilinkInsertProbePayload(): NativeWysiwygWikilinkPayload {
  return {
    label: probeTarget,
    target: probeTarget,
  }
}

export function nativeWysiwygPersonMentionInsertProbePayload(): NativeWysiwygWikilinkPayload {
  return {
    label: personMentionProbeLabel,
    target: personMentionProbeTarget,
  }
}

export function nativeWysiwygEmojiInsertProbePayload(): NativeWysiwygPlainTextPayload {
  return {
    text: expectedEmoji,
  }
}

export function nativeWysiwygPersonMentionInsertProbeContent(): object {
  return {
    content: [
      {
        content: [{ text: personMentionProbeSource, type: 'text' }],
        type: 'paragraph',
      },
      {
        content: [{ text: emojiProbeSource, type: 'text' }],
        type: 'paragraph',
      },
    ],
    type: 'doc',
  }
}

export function nativeWysiwygPersonMentionInsertProbeSelection(): NativeWysiwygSelection {
  return { from: 5, to: 8 }
}

export function nativeWysiwygEmojiInsertProbeSelection(): NativeWysiwygSelection {
  return { from: 15, to: 20 }
}

export function nativeWysiwygWikilinkInsertProof({
  content,
  noteId,
}: {
  content: MarkdownContent
  noteId: NoteId
}): NativeWysiwygWikilinkInsertProof {
  return {
    contentLength: content.length,
    insertedEmojiSaved: content.includes(expectedEmoji),
    insertedEmojiSourceRemoved: !content.includes(emojiProbeShortcode),
    insertedPersonMentionSaved: content.includes(expectedPersonMentionWikilink),
    insertedPersonMentionSourceRemoved: !content.includes('@Lu'),
    insertedWikilinkSaved: content.includes(expectedWikilink),
    noteId,
  }
}

export function nativeWysiwygWikilinkInsertLogLine(
  proof: NativeWysiwygWikilinkInsertProof,
): ProbeLine {
  return `${nativeWysiwygWikilinkInsertLogPrefix} ${JSON.stringify(proof)}`
}

export function parseNativeWysiwygWikilinkInsertProofs(
  logText: ProbeLogText,
): NativeWysiwygWikilinkInsertProof[] {
  return logText
    .split('\n')
    .map(parseProofLine)
    .filter((proof): proof is NativeWysiwygWikilinkInsertProof => proof !== null)
}

export function assertNativeWysiwygWikilinkInsertProofs(
  proofs: NativeWysiwygWikilinkInsertProof[],
): NativeWysiwygWikilinkInsertAssertionFailure[] {
  const latest = proofs.at(-1)
  if (!latest) {
    return [{ id: 'editor.wysiwyg.wikilinkInsert', message: 'Native WYSIWYG wikilink insert proof was not logged' }]
  }

  return [
    proofFailure(
      latest.insertedWikilinkSaved,
      'editor.wysiwyg.wikilinkInsert.saved',
      'Native WYSIWYG picker insertion saves as desktop wikilink markdown',
    ),
    proofFailure(
      latest.insertedPersonMentionSaved,
      'editor.wysiwyg.wikilinkInsert.personMentionSaved',
      'Native WYSIWYG person mention insertion saves as a desktop wikilink alias',
    ),
    proofFailure(
      latest.insertedPersonMentionSourceRemoved,
      'editor.wysiwyg.wikilinkInsert.personMentionReplacement',
      'Native WYSIWYG person mention insertion replaces the typed @ query',
    ),
    proofFailure(
      latest.insertedEmojiSaved,
      'editor.wysiwyg.wikilinkInsert.emojiSaved',
      'Native WYSIWYG emoji insertion saves as plain markdown emoji text',
    ),
    proofFailure(
      latest.insertedEmojiSourceRemoved,
      'editor.wysiwyg.wikilinkInsert.emojiReplacement',
      'Native WYSIWYG emoji insertion replaces the typed shortcode query',
    ),
  ].filter((failure): failure is NativeWysiwygWikilinkInsertAssertionFailure => failure !== null)
}

export function formatNativeWysiwygWikilinkInsertFailures(
  failures: NativeWysiwygWikilinkInsertAssertionFailure[],
): string {
  return failures.map((failure) => `${failure.id}: ${failure.message}`).join('\n')
}

export function nativeWysiwygWikilinkInsertProbeEnabled(searchParams: URLSearchParams): boolean {
  return searchParams.get('wysiwygWikilinkInsertProbe') === '1'
}

function parseProofLine(line: ProbeLine): NativeWysiwygWikilinkInsertProof | null {
  const prefixIndex = line.indexOf(nativeWysiwygWikilinkInsertLogPrefix)
  if (prefixIndex === -1) return null

  const rawJson = line.slice(prefixIndex + nativeWysiwygWikilinkInsertLogPrefix.length).trim()
  try {
    return parsedProof(JSON.parse(rawJson))
  } catch {
    return null
  }
}

function parsedProof(value: unknown): NativeWysiwygWikilinkInsertProof | null {
  if (!hasProofShape(value)) return null

  return {
    contentLength: value.contentLength,
    insertedEmojiSaved: value.insertedEmojiSaved,
    insertedEmojiSourceRemoved: value.insertedEmojiSourceRemoved,
    insertedPersonMentionSaved: value.insertedPersonMentionSaved,
    insertedPersonMentionSourceRemoved: value.insertedPersonMentionSourceRemoved,
    insertedWikilinkSaved: value.insertedWikilinkSaved,
    noteId: value.noteId,
  }
}

function hasProofShape(value: unknown): value is NativeWysiwygWikilinkInsertProof {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return Object.entries(proofFieldTypes).every(([field, type]) => (
    typeof candidate[field] === type
  ))
}

function proofFailure(
  passed: boolean,
  id: string,
  message: string,
): NativeWysiwygWikilinkInsertAssertionFailure | null {
  return passed ? null : { id, message }
}
