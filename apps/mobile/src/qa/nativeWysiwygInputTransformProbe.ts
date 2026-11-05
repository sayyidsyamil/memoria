import type { TiptapJsonNode } from '../workspace/mobileDocumentContent'

type ProbeLogText = string
type ProbeLine = string
type StepId = 'arrow' | 'escapedArrow' | 'highlight' | 'inlineMath'
type BooleanProofField = 'highlightMarkApplied' | 'mathInlineApplied' | 'mathInlineRendered' | 'transformed'

const booleanProofFields: readonly BooleanProofField[] = [
  'highlightMarkApplied',
  'mathInlineApplied',
  'mathInlineRendered',
  'transformed',
]

export type NativeWysiwygInputTransformProof = {
  highlightMarkApplied: boolean
  markdown: string
  mathInlineApplied: boolean
  mathInlineRendered: boolean
  step: StepId
  transformed: boolean
}

export type NativeWysiwygInputTransformProbeStep = {
  content: TiptapJsonNode
  input: string
  selection: { from: number; to: number }
  step: StepId
}

export type NativeWysiwygInputTransformAssertionFailure = {
  id: string
  message: string
}

export const nativeWysiwygInputTransformLogPrefix = 'MEMORIA_MOBILE_WYSIWYG_INPUT_TRANSFORM_PROBE'

export function nativeWysiwygInputTransformProbeSteps(): NativeWysiwygInputTransformProbeStep[] {
  return [
    {
      content: textProbeContent('Flow -'),
      input: '>',
      selection: { from: 7, to: 7 },
      step: 'arrow',
    },
    {
      content: textProbeContent('Flow \\-'),
      input: '>',
      selection: { from: 8, to: 8 },
      step: 'escapedArrow',
    },
    {
      content: textProbeContent('Use ==marked= today.'),
      input: '=',
      selection: { from: 14, to: 14 },
      step: 'highlight',
    },
    {
      content: textProbeContent('Inline $x^2$'),
      input: ' ',
      selection: { from: 13, to: 13 },
      step: 'inlineMath',
    },
  ]
}

export function nativeWysiwygInputTransformProof({
  json,
  mathInlineRendered = false,
  step,
  transformed,
}: {
  json: unknown
  mathInlineRendered?: boolean
  step: StepId
  transformed: boolean
}): NativeWysiwygInputTransformProof {
  return {
    highlightMarkApplied: containsHighlightMark(json),
    markdown: probeMarkdownFromJson(json),
    mathInlineApplied: containsMathInline(json),
    mathInlineRendered,
    step,
    transformed,
  }
}

export function nativeWysiwygInputTransformLogLine(
  proof: NativeWysiwygInputTransformProof,
): ProbeLine {
  return `${nativeWysiwygInputTransformLogPrefix} ${JSON.stringify(proof)}`
}

export function parseNativeWysiwygInputTransformProofs(
  logText: ProbeLogText,
): NativeWysiwygInputTransformProof[] {
  return logText
    .split('\n')
    .map(parseProofLine)
    .filter((proof): proof is NativeWysiwygInputTransformProof => proof !== null)
}

export function assertNativeWysiwygInputTransformProofs(
  proofs: NativeWysiwygInputTransformProof[],
): NativeWysiwygInputTransformAssertionFailure[] {
  return [
    proofFailure(
      hasProof(proofs, { markdown: 'Flow →', step: 'arrow', transformed: true }),
      'editor.wysiwyg.inputTransform.arrow',
      'Native WYSIWYG applies desktop arrow ligature input transforms',
    ),
    proofFailure(
      hasProof(proofs, { markdown: 'Flow ->', step: 'escapedArrow', transformed: true }),
      'editor.wysiwyg.inputTransform.escapedArrow',
      'Native WYSIWYG keeps escaped desktop arrow input literal',
    ),
    proofFailure(
      hasProof(proofs, { highlightMarkApplied: true, markdown: 'Use ==marked== today.', step: 'highlight', transformed: true }),
      'editor.wysiwyg.inputTransform.highlight',
      'Native WYSIWYG applies completed desktop highlight syntax as a mark',
    ),
    proofFailure(
      hasProof(proofs, { markdown: 'Inline $x^2$ ', mathInlineApplied: true, mathInlineRendered: true, step: 'inlineMath', transformed: true }),
      'editor.wysiwyg.inputTransform.inlineMath',
      'Native WYSIWYG applies completed desktop inline math syntax as a rendered math node',
    ),
  ].filter((failure): failure is NativeWysiwygInputTransformAssertionFailure => failure !== null)
}

export function formatNativeWysiwygInputTransformFailures(
  failures: NativeWysiwygInputTransformAssertionFailure[],
): string {
  return failures.map((failure) => `${failure.id}: ${failure.message}`).join('\n')
}

export function nativeWysiwygInputTransformProbeEnabled(searchParams: URLSearchParams): boolean {
  return searchParams.get('wysiwygInputTransformProbe') === '1'
}

function textProbeContent(text: string): TiptapJsonNode {
  return {
    content: [
      {
        content: [{ text, type: 'text' }],
        type: 'paragraph',
      },
    ],
    type: 'doc',
  }
}

function parseProofLine(line: ProbeLine): NativeWysiwygInputTransformProof | null {
  const prefixIndex = line.indexOf(nativeWysiwygInputTransformLogPrefix)
  if (prefixIndex === -1) return null

  const rawJson = line.slice(prefixIndex + nativeWysiwygInputTransformLogPrefix.length).trim()
  try {
    return parsedProof(JSON.parse(rawJson))
  } catch {
    return null
  }
}

function parsedProof(value: unknown): NativeWysiwygInputTransformProof | null {
  const candidate = proofCandidate(value)
  if (!candidate) return null

  return nativeWysiwygInputTransformProofFromCandidate(candidate)
}

function proofCandidate(value: unknown): Partial<NativeWysiwygInputTransformProof> | null {
  return value && typeof value === 'object'
    ? value as Partial<NativeWysiwygInputTransformProof>
    : null
}

function nativeWysiwygInputTransformProofFromCandidate(
  candidate: Partial<NativeWysiwygInputTransformProof>,
): NativeWysiwygInputTransformProof | null {
  return isNativeWysiwygInputTransformProof(candidate) ? {
    highlightMarkApplied: candidate.highlightMarkApplied,
    markdown: candidate.markdown,
    mathInlineApplied: candidate.mathInlineApplied,
    mathInlineRendered: candidate.mathInlineRendered,
    step: candidate.step,
    transformed: candidate.transformed,
  } : null
}

function isNativeWysiwygInputTransformProof(
  candidate: Partial<NativeWysiwygInputTransformProof>,
): candidate is NativeWysiwygInputTransformProof {
  return isStepId(candidate.step)
    && typeof candidate.markdown === 'string'
    && booleanProofFields.every((field) => typeof candidate[field] === 'boolean')
}

function hasProof(
  proofs: NativeWysiwygInputTransformProof[],
  expected: Partial<NativeWysiwygInputTransformProof> & Pick<NativeWysiwygInputTransformProof, 'step'>,
): boolean {
  return proofs.some((proof) => proofMatchesExpected(proof, expected))
}

function proofMatchesExpected(
  proof: NativeWysiwygInputTransformProof,
  expected: Partial<NativeWysiwygInputTransformProof> & Pick<NativeWysiwygInputTransformProof, 'step'>,
): boolean {
  return proof.step === expected.step
    && optionalProofFieldMatches(proof.markdown, expected.markdown)
    && optionalProofFieldMatches(proof.transformed, expected.transformed)
    && optionalProofFieldMatches(proof.highlightMarkApplied, expected.highlightMarkApplied)
    && optionalProofFieldMatches(proof.mathInlineApplied, expected.mathInlineApplied)
    && optionalProofFieldMatches(proof.mathInlineRendered, expected.mathInlineRendered)
}

function optionalProofFieldMatches<T>(actual: T, expected: T | undefined): boolean {
  return expected === undefined || actual === expected
}

function proofFailure(
  passed: boolean,
  id: string,
  message: string,
): NativeWysiwygInputTransformAssertionFailure | null {
  return passed ? null : { id, message }
}

function isStepId(value: unknown): value is StepId {
  return value === 'arrow' || value === 'escapedArrow' || value === 'highlight' || value === 'inlineMath'
}

function containsHighlightMark(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const node = value as Partial<TiptapJsonNode>
  if (node.marks?.some((mark) => mark.type === 'highlight')) return true
  return node.content?.some(containsHighlightMark) ?? false
}

function containsMathInline(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const node = value as Partial<TiptapJsonNode>
  if (node.type === 'mathInline') return true
  return node.content?.some(containsMathInline) ?? false
}

function probeMarkdownFromJson(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const node = value as Partial<TiptapJsonNode>
  if (node.type === 'text') return markedProbeText(node)
  if (node.type === 'mathInline') return `$${mathInlineLatex(node)}$`
  return node.content?.map(probeMarkdownFromJson).join(node.type === 'doc' ? '\n\n' : '') ?? ''
}

function mathInlineLatex(node: Partial<TiptapJsonNode>): string {
  return typeof node.attrs?.latex === 'string' ? node.attrs.latex : ''
}

function markedProbeText(node: Partial<TiptapJsonNode>): string {
  const text = node.text ?? ''
  return node.marks?.some((mark) => mark.type === 'highlight') ? `==${text}==` : text
}
