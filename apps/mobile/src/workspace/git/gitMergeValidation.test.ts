import { expect, it } from 'vitest'
import { validSyncMetadata } from './gitMergeValidation'

it.each([
  ['note.md', '---\nkey: 1\nkey: 2\n---\n'],
  ['note.md', '---\nkey: [\n---\n'],
  ['note.md', '---\nkey: 1\n'],
  ['note.md', '---\n- wrong root\n---\n'],
  ['views/test.yaml', 'filters:\n  all: []\n  any: []\n'],
  ['views/test.yml', 'filters:\n  all:\n    - field: type\n      op: unknown\n'],
  ['config/settings.json', '{"x":'],
  ['config/settings.json', '[]'],
])('rejects invalid metadata in %s', (path, content) => {
  expect(validSyncMetadata(path, content)).toBe(false)
})

it.each([
  ['note.md', 'No frontmatter\n---\nBody'],
  ['note.md', '\uFEFF---\r\ncustom: {list: [1, true]}\r\n---\r\nBody'],
  ['note.md', '---\n# empty header\n---\n'],
  ['views/test.yaml', 'name: Test\nfilters:\n  all:\n    - field: type\n      op: equals\n      value: Essay\n'],
  ['config/settings.json', '{"custom":true}'],
  ['ordinary.json', 'not a Memoria config'],
])('accepts supported metadata without normalizing %s', (path, content) => {
  expect(validSyncMetadata(path, content)).toBe(true)
})
