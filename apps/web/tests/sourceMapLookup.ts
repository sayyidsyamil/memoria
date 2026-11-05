// TOL-232: resolves a generated position through a source map (version 3), so the Sentry spec
// can check that a stack frame of the served bundle maps back to the source file and line.

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const VLQ_CONTINUATION = 32
const VLQ_DIGIT_MASK = 31

export interface SourceMap {
  sources: string[]
  mappings: string
}

export interface OriginalPosition {
  source: string
  /** 1-based, like a stack frame. */
  line: number
}

interface MappingState {
  source: number
  line: number
  column: number
}

function decodeVlq(segment: string): number[] {
  const values: number[] = []
  let value = 0
  let shift = 0
  for (const char of segment) {
    const digit = BASE64.indexOf(char)
    value += (digit & VLQ_DIGIT_MASK) << shift
    if (digit & VLQ_CONTINUATION) {
      shift += 5
      continue
    }
    values.push(value & 1 ? -(value >>> 1) : value >>> 1)
    value = 0
    shift = 0
  }
  return values
}

function advance(state: MappingState, fields: number[]): void {
  if (fields.length < 4) return
  state.source += fields[1]
  state.line += fields[2]
  state.column += fields[3]
}

/** The original position of a 1-based generated line and column, or null when unmapped. */
export function originalPosition(map: SourceMap, line: number, column: number): OriginalPosition | null {
  const state: MappingState = { source: 0, line: 0, column: 0 }
  const lines = map.mappings.split(';')
  let found: OriginalPosition | null = null
  for (let index = 0; index < line; index += 1) {
    let generatedColumn = 0
    for (const segment of (lines[index] ?? '').split(',').filter(Boolean)) {
      const fields = decodeVlq(segment)
      generatedColumn += fields[0]
      advance(state, fields)
      const onTargetLine = index === line - 1 && fields.length >= 4 && generatedColumn <= column - 1
      if (onTargetLine) found = { source: map.sources[state.source], line: state.line + 1 }
    }
  }
  return found
}
