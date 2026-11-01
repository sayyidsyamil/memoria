type ExternalLinkProbeContent = string
type ExternalLinkProbeLine = string
type ExternalLinkProbeLogText = string
type NoteId = string

export type NativeWysiwygExternalLinkProof = {
  contentLength: number
  linkSaved: boolean
  normalizedUrlSaved: boolean
  noteId: NoteId
  sourceTextPreserved: boolean
  unlinkSaved: boolean
}

export type NativeWysiwygExternalLinkAssertionFailure = {
  id: string
  message: string
}

const nativeWysiwygExternalLinkProbeLabel = 'Memoria'
const nativeWysiwygExternalLinkProbeUrl = 'https://memoria.app/docs'
const nativeWysiwygExternalLinkExpectedMarkdown = `[${nativeWysiwygExternalLinkProbeLabel}](${nativeWysiwygExternalLinkProbeUrl})`
const proofFieldTypes = {
  contentLength: 'number',
  linkSaved: 'boolean',
  normalizedUrlSaved: 'boolean',
  noteId: 'string',
  sourceTextPreserved: 'boolean',
  unlinkSaved: 'boolean',
} as const

export const nativeWysiwygExternalLinkLogPrefix = 'MEMORIA_MOBILE_WYSIWYG_EXTERNAL_LINK_PROBE'

export function nativeWysiwygExternalLinkProbeContent(): object {
  return {
    content: [
      {
        content: [{ text: nativeWysiwygExternalLinkProbeLabel, type: 'text' }],
        type: 'paragraph',
      },
    ],
    type: 'doc',
  }
}

export function nativeWysiwygExternalLinkProbeSelection() {
  return {
    from: 1,
    to: nativeWysiwygExternalLinkProbeLabel.length + 1,
  }
}

export function nativeWysiwygExternalLinkProbeNormalizedUrl(): string {
  return nativeWysiwygExternalLinkProbeUrl
}

export function nativeWysiwygExternalLinkProof({
  content,
  noteId,
}: {
  content: ExternalLinkProbeContent
  noteId: NoteId
}): NativeWysiwygExternalLinkProof {
  const sourceTextPreserved = content.includes(nativeWysiwygExternalLinkProbeLabel)

  return {
    contentLength: content.length,
    linkSaved: content.includes(nativeWysiwygExternalLinkExpectedMarkdown),
    normalizedUrlSaved: content.includes(nativeWysiwygExternalLinkProbeUrl),
    noteId,
    sourceTextPreserved,
    unlinkSaved: sourceTextPreserved
      && !content.includes(nativeWysiwygExternalLinkExpectedMarkdown)
      && !content.includes(nativeWysiwygExternalLinkProbeUrl),
  }
}

export function nativeWysiwygExternalLinkLogLine(
  proof: NativeWysiwygExternalLinkProof,
): ExternalLinkProbeLine {
  return `${nativeWysiwygExternalLinkLogPrefix} ${JSON.stringify(proof)}`
}

export function parseNativeWysiwygExternalLinkProofs(
  logText: ExternalLinkProbeLogText,
): NativeWysiwygExternalLinkProof[] {
  return logText
    .split('\n')
    .map(parseProofLine)
    .filter((proof): proof is NativeWysiwygExternalLinkProof => proof !== null)
}

export function assertNativeWysiwygExternalLinkProofs(
  proofs: NativeWysiwygExternalLinkProof[],
): NativeWysiwygExternalLinkAssertionFailure[] {
  if (proofs.length === 0) {
    return [{
      id: 'editor.wysiwyg.externalLink',
      message: 'Native WYSIWYG external-link proof was not logged',
    }]
  }

  return [
    proofFailure(
      proofs.some((proof) => proof.linkSaved && proof.normalizedUrlSaved && proof.sourceTextPreserved),
      'editor.wysiwyg.externalLink.saved',
      'Native WYSIWYG external-link action saves a normalized desktop Markdown link',
    ),
    proofFailure(
      proofs.some((proof) => proof.unlinkSaved && proof.sourceTextPreserved),
      'editor.wysiwyg.externalLink.removed',
      'Native WYSIWYG external-link removal saves plain text without the URL',
    ),
  ].filter((failure): failure is NativeWysiwygExternalLinkAssertionFailure => failure !== null)
}

export function formatNativeWysiwygExternalLinkFailures(
  failures: NativeWysiwygExternalLinkAssertionFailure[],
): string {
  return failures.map((failure) => `${failure.id}: ${failure.message}`).join('\n')
}

export function nativeWysiwygExternalLinkProbeEnabled(searchParams: URLSearchParams): boolean {
  return searchParams.get('wysiwygExternalLinkProbe') === '1'
}

function parseProofLine(line: ExternalLinkProbeLine): NativeWysiwygExternalLinkProof | null {
  const prefixIndex = line.indexOf(nativeWysiwygExternalLinkLogPrefix)
  if (prefixIndex === -1) return null

  const rawJson = line.slice(prefixIndex + nativeWysiwygExternalLinkLogPrefix.length).trim()
  try {
    return parsedProof(JSON.parse(rawJson))
  } catch {
    return null
  }
}

function parsedProof(value: unknown): NativeWysiwygExternalLinkProof | null {
  if (!hasProofShape(value)) return null

  return {
    contentLength: value.contentLength,
    linkSaved: value.linkSaved,
    normalizedUrlSaved: value.normalizedUrlSaved,
    noteId: value.noteId,
    sourceTextPreserved: value.sourceTextPreserved,
    unlinkSaved: value.unlinkSaved,
  }
}

function hasProofShape(value: unknown): value is NativeWysiwygExternalLinkProof {
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
): NativeWysiwygExternalLinkAssertionFailure | null {
  return passed ? null : { id, message }
}
