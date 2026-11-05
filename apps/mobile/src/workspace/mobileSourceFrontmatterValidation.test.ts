import { describe, expect, it } from 'vitest'
import { mobileSourceFrontmatterIssue } from './mobileSourceFrontmatterValidation'

describe('mobileSourceFrontmatterIssue', () => {
  it('accepts source without frontmatter', () => {
    expect(mobileSourceFrontmatterIssue('# Title\n\nBody')).toBeNull()
  })

  it('accepts valid LF and CRLF frontmatter', () => {
    expect(mobileSourceFrontmatterIssue('---\ntitle: My Note\n---\n\n# Title')).toBeNull()
    expect(mobileSourceFrontmatterIssue('---\r\ntitle: My Note\r\n---\r\n\r\n# Title')).toBeNull()
  })

  it('detects unclosed frontmatter like the desktop raw editor', () => {
    expect(mobileSourceFrontmatterIssue('---\ntitle: My Note\n\n# Title')).toBe('unclosedFrontmatter')
  })

  it('detects tab indentation inside frontmatter like the desktop raw editor', () => {
    expect(mobileSourceFrontmatterIssue('---\n\ttitle: My Note\n---\n')).toBe('tabIndentation')
  })
})
