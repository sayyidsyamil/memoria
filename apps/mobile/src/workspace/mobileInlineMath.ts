type InlineMathText = string
type LatexText = string
type TextCharacter = string

export type MobileInlineMathMatch = {
  end: number
  latex: LatexText
}

export type MobileCompletedInlineMathMatch = MobileInlineMathMatch & {
  start: number
}

type TextPosition = {
  index: number
  text: InlineMathText
}

export function readMobileInlineMathAt({
  index,
  text,
}: TextPosition): MobileInlineMathMatch | null {
  if (!isSingleDollar({ index, text }) || isEscaped({ index, text })) return null

  const end = findInlineMathEnd({ index, text })
  if (end === -1) return null

  const latex = text.slice(index + 1, end)
  return isValidInlineLatex(latex) ? { end, latex } : null
}

export function readCompletedMobileInlineMathAtEnd({
  text,
}: {
  text: string
}): MobileCompletedInlineMathMatch | null {
  const end = text.length - 1
  if (end < 1 || !isCompletedInlineMathEnd({ index: end, text })) return null

  const start = findCompletedInlineMathStart({ index: end, text })
  if (start === -1) return null

  const latex = text.slice(start + 1, end)
  return isValidInlineLatex(latex) ? { end, latex, start } : null
}

function findInlineMathEnd({ index: start, text }: TextPosition): number {
  for (let index = start + 1; index < text.length; index += 1) {
    if (isInlineMathEnd({ index, text })) return index
  }

  return -1
}

function findCompletedInlineMathStart({ index: end, text }: TextPosition): number {
  for (let index = end - 1; index >= 0; index -= 1) {
    if (isInlineMathEnd({ index, text }) && text.charAt(index - 1) !== '$') return index
  }

  return -1
}

function isCompletedInlineMathEnd(position: TextPosition): boolean {
  return isInlineMathEnd(position) && position.text.charAt(position.index - 1) !== '$'
}

function isInlineMathEnd(position: TextPosition): boolean {
  return isSingleDollar(position) && !isEscaped(position)
}

function isSingleDollar({ index, text }: TextPosition): boolean {
  return text.charAt(index) === '$'
    && text.charAt(index - 1) !== '$'
    && text.charAt(index + 1) !== '$'
}

function isEscaped({ index, text }: TextPosition): boolean {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && text.charAt(cursor) === '\\'; cursor -= 1) {
    slashCount += 1
  }

  return slashCount % 2 === 1
}

function isValidInlineLatex(latex: LatexText): boolean {
  return Boolean(latex.trim())
    && !/^\s|\s$/u.test(latex)
    && !looksLikeFinancialProse(latex)
}

function looksLikeFinancialProse(latex: LatexText): boolean {
  const trimmed = latex.trim()
  return hasFinancialAmountPrefix(trimmed) && hasProseAfterAmount(trimmed)
}

function hasFinancialAmountPrefix(text: InlineMathText): boolean {
  const integerEnd = scanIntegerAmount(text)
  if (integerEnd === 0) return false

  const suffixIndex = scanDecimalAmount(text, integerEnd)
  if (!isFinancialSuffix(text.charAt(suffixIndex))) return false

  const nextChar = text.charAt(suffixIndex + 1)
  return nextChar === ',' || nextChar === '.' || nextChar === ')' || /\s/u.test(nextChar)
}

function scanIntegerAmount(text: InlineMathText): number {
  if (!isAsciiDigit(text.charAt(0))) return 0

  let index = 0
  while (isAsciiDigit(text.charAt(index)) || text.charAt(index) === ',') index += 1
  return index
}

function scanDecimalAmount(text: InlineMathText, index: number): number {
  if (text.charAt(index) !== '.') return index

  let nextIndex = index + 1
  if (!isAsciiDigit(text.charAt(nextIndex))) return index
  while (isAsciiDigit(text.charAt(nextIndex))) nextIndex += 1
  return nextIndex
}

function isFinancialSuffix(char: TextCharacter): boolean {
  return 'KMBT%'.includes(char.toUpperCase())
}

function hasProseAfterAmount(text: InlineMathText): boolean {
  for (let index = 0; index < text.length - 2; index += 1) {
    const current = text.charAt(index)
    const next = text.charAt(index + 1)
    if (isPunctuationFollowedBySpace(current, next)) return true
    if (startsProseWordAfterSpace({ current, next, text, index })) return true
  }

  return false
}

function isPunctuationFollowedBySpace(current: TextCharacter, next: TextCharacter): boolean {
  return isAmountSeparator(current) && /\s/u.test(next)
}

function startsProseWordAfterSpace({
  current,
  index,
  next,
  text,
}: TextPosition & {
  current: TextCharacter
  next: TextCharacter
}): boolean {
  return /\s/u.test(current) && isAsciiLetter(next) && isAsciiLetter(text.charAt(index + 2))
}

function isAmountSeparator(char: TextCharacter): boolean {
  return char === ',' || char === '.'
}

function isAsciiDigit(char: TextCharacter): boolean {
  return char >= '0' && char <= '9'
}

function isAsciiLetter(char: TextCharacter): boolean {
  const lowerChar = char.toLowerCase()
  return lowerChar >= 'a' && lowerChar <= 'z'
}
