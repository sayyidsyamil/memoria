import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'

const require = createRequire(import.meta.url)
const { buildCooperativeWorkspaceSnapshot }: typeof import('../../apps/mobile/src/workspace/cooperativeWorkspaceSnapshot') =
  require('../../apps/mobile/src/workspace/cooperativeWorkspaceSnapshot')
const { readWorkspaceSnapshotPreview }: typeof import('../../apps/mobile/src/workspace/workspaceSnapshotPreview') =
  require('../../apps/mobile/src/workspace/workspaceSnapshotPreview')
const { notesForSidebarSelection }: typeof import('../../apps/mobile/src/screens/tabletWorkspaceNavigationSelectors') =
  require('../../apps/mobile/src/screens/tabletWorkspaceNavigationSelectors')
const { mobileSnapshotWithRequestedSelectedNote }: typeof import('../../apps/mobile/src/screens/mobileUiLabSelectedNote') =
  require('../../apps/mobile/src/screens/mobileUiLabSelectedNote')
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

test('@smoke cached mobile navigation hands note choice to fresh sources without stale replay', async () => {
  const f = fixture()
  await buildCooperativeWorkspaceSnapshot(f.options, undefined, { storage: f.storage })
  const preview = await readWorkspaceSnapshotPreview(f.options, f.storage)
  expect(preview).not.toBeNull()
  if (!preview) throw new Error('Expected owned metadata preview')
  const notes = notesForSidebarSelection(preview, { kind: 'item', id: 'type-note', label: 'Notes', typeName: 'Note', sectionId: 'types' })
  const chosen = notes[21].id
  expect(notes[21]).not.toHaveProperty('rawContent')
  const files = f.options.files.map(file => file.relativePath === chosen
    ? { ...file, content: file.content.replace('Original', 'Changed!'), contentDigest: digest(file.content.replace('Original', 'Changed!')) }
    : file)
  const current = await buildCooperativeWorkspaceSnapshot({ ...f.options, files }, undefined, { storage: f.storage })
  const selected = mobileSnapshotWithRequestedSelectedNote(current, chosen)
  expect(selected.selectedNoteId).toBe(chosen)
  expect(selected.notes.find(note => note.id === chosen)?.rawContent).toContain('Changed!')
  expect(f.options.files.find(file => file.relativePath === chosen)?.content).toContain('Original')
})

test('@smoke a note removed during background refresh cannot be resurrected by cached selection', async () => {
  const f = fixture()
  await buildCooperativeWorkspaceSnapshot(f.options, undefined, { storage: f.storage })
  const chosen = f.options.files[21].relativePath
  const current = await buildCooperativeWorkspaceSnapshot({ ...f.options,
    files: f.options.files.filter(file => file.relativePath !== chosen) }, undefined, { storage: f.storage })
  const selected = mobileSnapshotWithRequestedSelectedNote(current, chosen)
  expect(selected).toBe(current)
  expect(selected.allNotes?.some(note => note.id === chosen)).toBe(false)
})

function fixture() {
  const records = new Map<string, string>()
  const storage = { revision: 'owned-smoke:1', digest: async (value: string) => digest(value),
    read: async (key: string) => records.get(key) ?? null,
    write: async (key: string, value: string) => { records.set(key, value) } }
  const files = Array.from({ length: 129 }, (_, index) => {
    const content = `---\ntype: Note\ncustom: retained\n---\n# Original ${index}\n`
    return { absolutePath: `/owned-fixture/note-${index}.md`, relativePath: `note-${index}.md`, content,
      contentDigest: digest(content), createdAt: 1000, modifiedAt: 1000, size: content.length }
  })
  return { storage, options: { vaultPath: 'file:///owned-fixture', vaultLabel: 'Owned fixture', files, maxNotes: files.length } }
}
