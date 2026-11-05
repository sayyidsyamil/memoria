export type MobileSourceFrontmatterIssue = 'tabIndentation' | 'unclosedFrontmatter'

const FRONTMATTER_CLOSE = /(?:^|\r?\n)---(?:\r?\n|$)/

export function mobileSourceFrontmatterIssue(content: string): MobileSourceFrontmatterIssue | null {
  if (!content.startsWith('---')) return null

  const rest = content.slice(3)
  const closeIndex = rest.search(FRONTMATTER_CLOSE)
  if (closeIndex === -1) return 'unclosedFrontmatter'

  const block = rest.slice(0, closeIndex)
  return /^\t/m.test(block) ? 'tabIndentation' : null
}

export function hasMobileSourceFrontmatterIssue(content: string): boolean {
  return mobileSourceFrontmatterIssue(content) !== null
}
