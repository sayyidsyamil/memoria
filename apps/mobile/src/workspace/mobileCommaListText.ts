type CommaListText = string

export function formatMobileCommaListText(values: string[]): CommaListText {
  return values.map(commaListItemFormText).join(', ')
}

export function parseMobileCommaListText(value: CommaListText): string[] {
  return mobileCommaListTextParts(value).filter(Boolean)
}

export function mobileCommaListTextParts(value: CommaListText): string[] {
  return splitCommaListText(value).map(commaListItemValue)
}

function commaListItemFormText(value: string): string {
  return shouldQuoteCommaListItem(value) ? JSON.stringify(value) : value
}

function shouldQuoteCommaListItem(value: string): boolean {
  return value.trim() !== value || value.includes(',')
}

function commaListItemValue(value: string): string {
  const trimmed = value.trim()
  const quote = commaListItemQuote(trimmed)
  if (quote === null) return trimmed
  return unquoteCommaListItem(trimmed.slice(1, -1), quote)
}

function splitCommaListText(value: CommaListText): string[] {
  const parts: string[] = []
  let quote: '"' | '\'' | null = null
  let startIndex = 0

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char === '\\' && quote === '"') {
      index += 1
      continue
    }
    if (isCommaListQuote(char)) {
      quote = quote === char ? null : quote ?? char
      continue
    }
    if (char === ',' && quote === null) {
      parts.push(value.slice(startIndex, index))
      startIndex = index + 1
    }
  }

  parts.push(value.slice(startIndex))
  return parts
}

function commaListItemQuote(value: string): '"' | '\'' | null {
  const quote = value.at(0)
  if (isCommaListQuote(quote) && value.at(-1) === quote) return quote
  return null
}

function unquoteCommaListItem(value: string, quote: '"' | '\''): string {
  if (quote === '\'') return value.replaceAll("''", "'")

  try {
    return JSON.parse(`"${value}"`) as string
  } catch {
    return value.replace(/\\"/gu, '"')
  }
}

function isCommaListQuote(value: string | undefined): value is '"' | '\'' {
  return value === '"' || value === '\''
}
