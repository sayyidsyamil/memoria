export type NativeTableOfContentsProof = {
  afterY: number
  beforeY: number
  expectedY: number
  id: 'editor.tableOfContents.scroll'
  passed: boolean
  targetId: string
}

export type NativeTableOfContentsAssertionFailure = {
  id: NativeTableOfContentsProof['id']
  message: string
}

export type NativeTableOfContentsScrollProofInput = {
  afterY: number
  beforeY: number
  expectedY: number
  targetId: string
}

type NativeTableOfContentsProofFields = Pick<
  NativeTableOfContentsProof,
  'afterY' | 'beforeY' | 'expectedY' | 'targetId'
>

export const nativeTableOfContentsLogPrefix = 'MEMORIA_MOBILE_TABLE_OF_CONTENTS_PROBE'

const minimumScrollDelta = 80
const probeTitle = 'Table of Contents Probe'

export function nativeTableOfContentsProbeEnabled(searchParams: URLSearchParams): boolean {
  return searchParams.get('tableOfContentsProbe') === '1'
}

export function nativeTableOfContentsProbeContent(): string {
  const leadIn = Array.from({ length: 8 }, (_item, index) => (
    `Paragraph ${index + 1} keeps the mounted editor preview tall enough for native outline navigation proof. `
    + 'The target heading must stay within the rendered block budget while still sitting below the initial viewport. '
    + 'This line intentionally wraps across several visual rows in the tablet editor. '
    + 'Additional probe copy keeps the heading below a 13-inch iPad viewport without adding more rendered blocks. '
    + 'The native scroll proof should only pass when the editor scroll container actually moves.'
  ))

  return [
    `# ${probeTitle}`,
    '',
    ...leadIn.flatMap((line) => [line, '']),
    '## Target Section',
    '',
    'The native table of contents probe should scroll to this section.',
  ].join('\n')
}

export function nativeTableOfContentsProbeTitle(): string {
  return probeTitle
}

export function nativeTableOfContentsScrollProof(input: NativeTableOfContentsScrollProofInput): NativeTableOfContentsProof {
  const scrollDelta = input.afterY - input.beforeY

  return {
    ...input,
    id: 'editor.tableOfContents.scroll',
    passed: scrollDelta >= minimumScrollDelta && input.afterY > 0 && input.expectedY > 0,
  }
}

export function nativeTableOfContentsLogLine(proof: NativeTableOfContentsProof): string {
  return `${nativeTableOfContentsLogPrefix} ${JSON.stringify(proof)}`
}

export function parseNativeTableOfContentsProofs(logText: string): NativeTableOfContentsProof[] {
  return logText
    .split(/\r?\n/u)
    .map(parseNativeTableOfContentsProofLine)
    .filter((proof): proof is NativeTableOfContentsProof => proof !== null)
}

export function assertNativeTableOfContentsProofs(
  proofs: NativeTableOfContentsProof[],
): NativeTableOfContentsAssertionFailure[] {
  const proof = proofs.find((candidate) => candidate.id === 'editor.tableOfContents.scroll')
  if (!proof) {
    return [{
      id: 'editor.tableOfContents.scroll',
      message: 'Native table of contents should scroll the editor to the selected heading.',
    }]
  }
  if (proof.passed) return []

  return [{
    id: 'editor.tableOfContents.scroll',
    message: `Native table of contents scroll did not move far enough: before=${proof.beforeY}, after=${proof.afterY}, expected=${proof.expectedY}.`,
  }]
}

export function formatNativeTableOfContentsFailures(
  failures: NativeTableOfContentsAssertionFailure[],
): string {
  return failures.map((failure) => `${failure.id}: ${failure.message}`).join('\n')
}

function parseNativeTableOfContentsProofLine(line: string): NativeTableOfContentsProof | null {
  const index = line.indexOf(nativeTableOfContentsLogPrefix)
  if (index === -1) return null

  const jsonStart = line.indexOf('{', index)
  if (jsonStart === -1) return null

  try {
    return normalizeNativeTableOfContentsProof(JSON.parse(line.slice(jsonStart)))
  } catch {
    return null
  }
}

function normalizeNativeTableOfContentsProof(value: unknown): NativeTableOfContentsProof | null {
  if (!isProofRecord(value)) return null
  if (!isNativeTableOfContentsProofId(value.id)) return null
  if (typeof value.passed !== 'boolean') return null

  const fields = nativeTableOfContentsProofFields(value)
  if (!fields) return null

  return {
    ...fields,
    id: value.id,
    passed: value.passed,
  }
}

function isProofRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object')
}

function isNativeTableOfContentsProofId(value: unknown): value is NativeTableOfContentsProof['id'] {
  return value === 'editor.tableOfContents.scroll'
}

function nativeTableOfContentsProofFields(
  value: Record<string, unknown>,
): NativeTableOfContentsProofFields | null {
  if (typeof value.afterY !== 'number') return null
  if (typeof value.beforeY !== 'number') return null
  if (typeof value.expectedY !== 'number') return null
  if (typeof value.targetId !== 'string') return null

  return {
    afterY: value.afterY,
    beforeY: value.beforeY,
    expectedY: value.expectedY,
    targetId: value.targetId,
  }
}
