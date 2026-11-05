export type MobileMarkdownTextSelection = {
  end: number
  start: number
}

export function mobileMarkdownSelectionAfterTextChange(
  previousText: string,
  nextText: string,
  previousSelection: MobileMarkdownTextSelection,
): MobileMarkdownTextSelection {
  if (previousText === nextText) return clampSelection(previousSelection, nextText.length)

  const prefixLength = sharedPrefixLength(previousText, nextText)
  const suffixLength = sharedSuffixLength(previousText, nextText, prefixLength)
  const insertedLength = Math.max(0, nextText.length - prefixLength - suffixLength)
  return collapsedSelection(prefixLength + insertedLength, nextText.length)
}

function sharedPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  for (let index = 0; index < limit; index += 1) {
    if (left[index] !== right[index]) return index
  }
  return limit
}

function sharedSuffixLength(left: string, right: string, prefixLength: number): number {
  const limit = Math.min(left.length, right.length) - prefixLength
  for (let offset = 0; offset < limit; offset += 1) {
    if (left[left.length - offset - 1] !== right[right.length - offset - 1]) return offset
  }
  return limit
}

function clampSelection(selection: MobileMarkdownTextSelection, textLength: number): MobileMarkdownTextSelection {
  const start = clampIndex(selection.start, textLength)
  const end = clampIndex(selection.end, textLength)
  return { start: Math.min(start, end), end: Math.max(start, end) }
}

function collapsedSelection(index: number, textLength: number): MobileMarkdownTextSelection {
  const cursor = clampIndex(index, textLength)
  return { start: cursor, end: cursor }
}

function clampIndex(index: number, textLength: number): number {
  return Math.max(0, Math.min(index, textLength))
}
