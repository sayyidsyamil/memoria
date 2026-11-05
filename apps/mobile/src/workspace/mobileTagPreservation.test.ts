import { expect, it } from 'vitest'
import { buildLocalVaultWorkspaceSnapshot } from './localVaultSnapshot'
import { frontmatterList, parseLocalVaultDocument } from './localVaultFrontmatter'
import { applyMobileWorkspaceEditWithWrites } from './mobileWorkspaceEditing'
import { mobilePropertyValueFormText, parseMobilePropertyValue } from './mobilePropertyValues'
import { mobileNoteIdentityMatchesQuery } from './mobileNoteSearch'

const tags = [...Array.from({ length: 11 }, (_, index) => `tag-${index + 1}`), 'Research, AI']
const content = `---\nTags: ${JSON.stringify(tags)}\nowner: Ada\ncustom: keep-me\n---\n# Tagged note\n\nOriginal body.\n`

function snapshot(maxNotes = 80) {
  return buildLocalVaultWorkspaceSnapshot({
    vaultLabel: 'Tag test', vaultPath: '/qa-tags', maxNotes,
    files: [{
      absolutePath: '/qa-tags/tagged.md', relativePath: 'tagged.md', content,
      createdAt: 1, modifiedAt: 1, size: content.length,
    }],
  })
}

it('keeps every tag in editable and summary notes, including search beyond the eighth tag', () => {
  const loaded = snapshot()
  expect(loaded.notes[0].tags).toEqual(tags)
  expect(loaded.allNotes?.[0].tags).toEqual(tags)
  expect(mobileNoteIdentityMatchesQuery(loaded.notes[0], 'tag-11')).toBe(true)
})

it('preserves every tag when a metadata-only note is hydrated', () => {
  const result = applyMobileWorkspaceEditWithWrites(snapshot(0), {
    type: 'hydrateNoteContent', noteId: 'tagged.md', rawContent: content,
  })
  expect(result.snapshot.allNotes?.[0].tags).toEqual(tags)
  expect(result.writes).toEqual([])
})

it('keeps all tags in the editor model after a body edit', () => {
  const edited = `${content}\nAdded paragraph.\n`
  const result = applyMobileWorkspaceEditWithWrites(snapshot(), {
    type: 'updateNoteContent', noteId: 'tagged.md', content: edited,
  })
  expect(result.snapshot.notes[0].tags).toEqual(tags)
  expect(result.writes).toEqual([{ kind: 'saveNote', path: 'tagged.md', content: edited }])
})

it('round-trips the properties form without deleting hidden tags or unrelated frontmatter', () => {
  const loaded = snapshot()
  const formText = mobilePropertyValueFormText(loaded.notes[0].tags)
  const value = parseMobilePropertyValue({ key: 'tags', kind: 'list', valueText: `${formText}, Added` })
  const result = applyMobileWorkspaceEditWithWrites(loaded, {
    type: 'updateProperty', noteId: 'tagged.md', key: 'tags', value,
  })
  const write = result.writes[0]
  expect(write?.kind).toBe('saveNote')
  if (write?.kind !== 'saveNote') throw new Error('Expected persisted property edit')
  const document = parseLocalVaultDocument(write.content)
  expect(frontmatterList(document.frontmatter, ['tags', 'Tags'])).toEqual([...tags, 'Added'])
  expect(document.frontmatter).toMatchObject({ owner: 'Ada', custom: 'keep-me' })
  expect(document.body).toBe(parseLocalVaultDocument(content).body)
  expect(result.snapshot.notes[0].tags).toEqual([...tags, 'Added'])
})
