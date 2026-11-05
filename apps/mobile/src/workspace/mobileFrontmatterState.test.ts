import { describe, expect, it } from 'vitest'
import {
  mobileFrontmatterState,
  needsMobileFrontmatterNotice,
} from './mobileFrontmatterState'

describe('mobileFrontmatterState', () => {
  it('matches desktop inspector states for markdown notes', () => {
    expect(mobileFrontmatterState({ rawContent: '# Plain\n' })).toBe('none')
    expect(mobileFrontmatterState({ rawContent: '---\n---\n# Plain\n' })).toBe('empty')
    expect(mobileFrontmatterState({ rawContent: '---\ntype: Note\n---\n# Plain\n' })).toBe('valid')
    expect(mobileFrontmatterState({ rawContent: '---\nnot yaml\n---\n# Plain\n' })).toBe('invalid')
  })

  it('does not prompt for unresolved or unsupported note content', () => {
    expect(mobileFrontmatterState({})).toBe('unknown')
    expect(mobileFrontmatterState({ fileKind: 'text', rawContent: 'plain text' })).toBe('unsupported')
    expect(needsMobileFrontmatterNotice('unknown')).toBe(false)
    expect(needsMobileFrontmatterNotice('unsupported')).toBe(false)
  })
})
