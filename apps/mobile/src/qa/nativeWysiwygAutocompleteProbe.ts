import type { NativeWysiwygInlineAutocomplete } from '../components/workspace/MobileWysiwygWikilinkBridgeModel'

type ProbeLogText = string
type ProbeLine = string

export type NativeWysiwygAutocompleteProof = {
  kind: string
  query: string
  rangeFrom: number
  rangeTo: number
  scenario: string
}

export type NativeWysiwygAutocompleteProbeStep = {
  content: object
  scenario: string
  selection: { from: number; to: number }
}

export type NativeWysiwygAutocompleteAssertionFailure = {
  id: string
  message: string
}
type NativeWysiwygAutocompleteExpectedProof = NativeWysiwygAutocompleteAssertionFailure
  & NativeWysiwygAutocompleteProof

export const nativeWysiwygAutocompleteLogPrefix = 'MEMORIA_MOBILE_WYSIWYG_AUTOCOMPLETE_PROBE'
const expectedNativeWysiwygAutocompleteProofs: NativeWysiwygAutocompleteExpectedProof[] = [
  {
    id: 'editor.wysiwyg.autocomplete.wikilink',
    kind: 'wikilink',
    message: 'Native WYSIWYG detects wikilink autocomplete with the exact replacement range',
    query: 'AI',
    rangeFrom: 5,
    rangeTo: 9,
    scenario: 'wikilink',
  },
  {
    id: 'editor.wysiwyg.autocomplete.personMention',
    kind: 'personMention',
    message: 'Native WYSIWYG detects person mention autocomplete with the exact replacement range',
    query: 'Lu',
    rangeFrom: 5,
    rangeTo: 8,
    scenario: 'personMention',
  },
  {
    id: 'editor.wysiwyg.autocomplete.emoji',
    kind: 'emoji',
    message: 'Native WYSIWYG detects emoji shortcode autocomplete with the exact replacement range',
    query: 'rock',
    rangeFrom: 6,
    rangeTo: 11,
    scenario: 'emoji',
  },
  {
    id: 'editor.wysiwyg.autocomplete.inlineCodeSuppression',
    kind: '',
    message: 'Native WYSIWYG suppresses autocomplete inside inline code marks',
    query: '',
    rangeFrom: -1,
    rangeTo: -1,
    scenario: 'inlineCodeSuppression',
  },
  {
    id: 'editor.wysiwyg.autocomplete.codeBlockSuppression',
    kind: '',
    message: 'Native WYSIWYG suppresses autocomplete inside code blocks',
    query: '',
    rangeFrom: -1,
    rangeTo: -1,
    scenario: 'codeBlockSuppression',
  },
]

export function nativeWysiwygAutocompleteProbeContent(): object {
  return nativeWysiwygAutocompleteProbeSteps()[0].content
}

export function nativeWysiwygAutocompleteProbeSelection(): { from: number; to: number } {
  return nativeWysiwygAutocompleteProbeSteps()[0].selection
}

export function nativeWysiwygAutocompleteProbeSteps(): NativeWysiwygAutocompleteProbeStep[] {
  return [
    {
      content: textProbeContent('See [[AI'),
      scenario: 'wikilink',
      selection: { from: 9, to: 9 },
    },
    {
      content: textProbeContent('Ask @Lu'),
      scenario: 'personMention',
      selection: { from: 8, to: 8 },
    },
    {
      content: textProbeContent('Ship :rock'),
      scenario: 'emoji',
      selection: { from: 11, to: 11 },
    },
    {
      content: inlineCodeProbeContent('code [[AI'),
      scenario: 'inlineCodeSuppression',
      selection: { from: 10, to: 10 },
    },
    {
      content: codeBlockProbeContent('code [[AI'),
      scenario: 'codeBlockSuppression',
      selection: { from: 10, to: 10 },
    },
  ]
}

function textProbeContent(text: string): object {
  return documentProbeContent(paragraphProbeBlock([textProbeNode(text)]))
}

function inlineCodeProbeContent(text: string): object {
  return documentProbeContent(paragraphProbeBlock([textProbeNode(text, [{ type: 'code' }])]))
}

function codeBlockProbeContent(text: string): object {
  return documentProbeContent({
    attrs: { language: 'text' },
    content: [textProbeNode(text)],
    type: 'codeBlock',
  })
}

function documentProbeContent(block: object): object {
  return {
    content: [block],
    type: 'doc',
  }
}

function paragraphProbeBlock(content: object[]): object {
  return { content, type: 'paragraph' }
}

function textProbeNode(text: string, marks?: object[]): object {
  return marks ? { marks, text, type: 'text' } : { text, type: 'text' }
}

export function nativeWysiwygAutocompleteProof(
  match: NativeWysiwygInlineAutocomplete | null,
  scenario = 'legacy',
): NativeWysiwygAutocompleteProof {
  return {
    kind: match?.kind ?? '',
    query: match?.query ?? '',
    ...autocompleteRangeProof(match),
    scenario,
  }
}

function autocompleteRangeProof(match: NativeWysiwygInlineAutocomplete | null) {
  return { rangeFrom: match?.range.from ?? -1, rangeTo: match?.range.to ?? -1 }
}

export function nativeWysiwygAutocompleteLogLine(
  proof: NativeWysiwygAutocompleteProof,
): ProbeLine {
  return `${nativeWysiwygAutocompleteLogPrefix} ${JSON.stringify(proof)}`
}

export function parseNativeWysiwygAutocompleteProofs(
  logText: ProbeLogText,
): NativeWysiwygAutocompleteProof[] {
  return logText
    .split('\n')
    .map(parseProofLine)
    .filter((proof): proof is NativeWysiwygAutocompleteProof => proof !== null)
}

export function assertNativeWysiwygAutocompleteProofs(
  proofs: NativeWysiwygAutocompleteProof[],
): NativeWysiwygAutocompleteAssertionFailure[] {
  const latest = proofs.at(-1)
  if (!latest) {
    return [{ id: 'editor.wysiwyg.autocomplete', message: 'Native WYSIWYG autocomplete proof was not logged' }]
  }

  return expectedNativeWysiwygAutocompleteProofs
    .map((expected) => proofFailure(hasAutocompleteProof(proofs, expected), expected.id, expected.message))
    .filter((failure): failure is NativeWysiwygAutocompleteAssertionFailure => failure !== null)
}

export function formatNativeWysiwygAutocompleteFailures(
  failures: NativeWysiwygAutocompleteAssertionFailure[],
): string {
  return failures.map((failure) => `${failure.id}: ${failure.message}`).join('\n')
}

export function nativeWysiwygAutocompleteProbeEnabled(searchParams: URLSearchParams): boolean {
  return searchParams.get('wysiwygAutocompleteProbe') === '1'
}

function parseProofLine(line: ProbeLine): NativeWysiwygAutocompleteProof | null {
  const prefixIndex = line.indexOf(nativeWysiwygAutocompleteLogPrefix)
  if (prefixIndex === -1) return null

  const rawJson = line.slice(prefixIndex + nativeWysiwygAutocompleteLogPrefix.length).trim()
  try {
    return parsedProof(JSON.parse(rawJson))
  } catch {
    return null
  }
}

function parsedProof(value: unknown): NativeWysiwygAutocompleteProof | null {
  if (!isProbeRecord(value)) return null

  const scenario = proofScenario(value.scenario)
  if (scenario === null) return null

  const textFields = proofTextFields(value)
  if (!textFields) return null

  const rangeFields = proofRangeFields(value)
  if (!rangeFields) return null

  return {
    ...textFields,
    ...rangeFields,
    scenario,
  }
}

function isProbeRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object')
}

function proofScenario(value: unknown): string | null {
  if (value === undefined) return 'legacy'

  return typeof value === 'string' ? value : null
}

function proofTextFields(value: Record<string, unknown>): Pick<NativeWysiwygAutocompleteProof, 'kind' | 'query'> | null {
  if (typeof value.kind !== 'string') return null
  if (typeof value.query !== 'string') return null

  return { kind: value.kind, query: value.query }
}

function proofRangeFields(
  value: Record<string, unknown>,
): Pick<NativeWysiwygAutocompleteProof, 'rangeFrom' | 'rangeTo'> | null {
  if (typeof value.rangeFrom !== 'number') return null
  if (typeof value.rangeTo !== 'number') return null

  return { rangeFrom: value.rangeFrom, rangeTo: value.rangeTo }
}

function hasAutocompleteProof(
  proofs: NativeWysiwygAutocompleteProof[],
  expected: NativeWysiwygAutocompleteProof,
): boolean {
  return proofs.some((proof) => (
    proof.kind === expected.kind
    && proof.query === expected.query
    && proof.rangeFrom === expected.rangeFrom
    && proof.rangeTo === expected.rangeTo
    && proof.scenario === expected.scenario
  ))
}

function proofFailure(
  passed: boolean,
  id: string,
  message: string,
): NativeWysiwygAutocompleteAssertionFailure | null {
  return passed ? null : { id, message }
}
