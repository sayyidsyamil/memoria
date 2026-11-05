import { describe, expect, it } from 'vitest'
import { VaultError } from '../src/errors.ts'
import { blobEtag, conflictCopyPath, isNote, vaultPath } from '../src/paths.ts'
import { text } from './helpers.ts'

describe('vaultPath', () => {
  it('returns a valid relative path unchanged', () => {
    expect(vaultPath('projects/alpha.md')).toBe('projects/alpha.md')
    expect(vaultPath('note (conflict 2026-10-10 1903).md')).toBe('note (conflict 2026-10-10 1903).md')
    expect(vaultPath(':(glob)*.md')).toBe(':(glob)*.md')
  })

  it.each<[unknown, string]>([
    ['', 'empty'],
    [undefined, 'missing'],
    [42, 'not a string'],
    ['/etc/passwd', 'absolute'],
    ['../outside.md', 'parent segment'],
    ['notes/../../outside.md', 'nested parent segment'],
    ['notes//a.md', 'empty segment'],
    ['./a.md', 'dot segment'],
    ['notes/', 'trailing slash'],
    ['.git/config', 'git directory'],
    ['sub/.GIT/hooks/pre-push', 'git directory in any case'],
    ['.gitignore', 'git control file'],
    ['a\\b.md', 'backslash'],
    ['a\u0000b.md', 'NUL'],
    ['a\nb.md', 'newline'],
    ['a\u007fb.md', 'DEL'],
    [`${'a'.repeat(1025)}.md`, 'too long'],
  ])('rejects %j (%s)', (raw) => {
    expect(() => vaultPath(raw)).toThrowError(VaultError)
    expect(() => vaultPath(raw)).toThrowError(expect.objectContaining({ status: 400, code: 'invalid_path' }))
  })
})

describe('conflictCopyPath', () => {
  const now = new Date('2026-10-10T19:03:59Z')

  it('puts a UTC stamp before the extension, next to the original', () => {
    expect(conflictCopyPath(vaultPath('notes/a.md'), now, () => false)).toBe('notes/a (conflict 2026-10-10 1903).md')
    expect(conflictCopyPath(vaultPath('README'), now, () => false)).toBe('README (conflict 2026-10-10 1903)')
  })

  it('numbers the copy when the name is taken', () => {
    const taken = new Set(['a (conflict 2026-10-10 1903).md', 'a (conflict 2026-10-10 1903 2).md'])
    expect(conflictCopyPath(vaultPath('a.md'), now, (candidate) => taken.has(candidate))).toBe(
      'a (conflict 2026-10-10 1903 3).md',
    )
  })

  it('gives up instead of looping when every name is taken', () => {
    expect(() => conflictCopyPath(vaultPath('a.md'), now, () => true)).toThrowError(/no free conflict copy name/)
  })
})

describe('blobEtag', () => {
  it('is the git blob id of the bytes', () => {
    // `printf 'hello\n' | git hash-object --stdin`
    expect(blobEtag(text('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
    expect(blobEtag(new Uint8Array())).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
  })
})

describe('isNote', () => {
  it('recognises markdown files in any case', () => {
    expect(isNote('a.md')).toBe(true)
    expect(isNote('A.MD')).toBe(true)
    expect(isNote('a.png')).toBe(false)
  })
})
