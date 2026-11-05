type MarkdownText = string
type ProseTransform = (text: MarkdownText) => MarkdownText

/** Keep matched backtick spans literal while transforming surrounding prose. */
export function transformOutsideInlineCode(text: MarkdownText, transform: ProseTransform): MarkdownText {
  return text.split(/((?<!`)(`+)(?!`)[^\r\n]*?(?<!`)\2(?!`))/gu)
    .filter((_part, index) => index % 3 !== 2)
    .map((part, index) => index % 2 === 1 ? part : transform(part))
    .join('')
}
