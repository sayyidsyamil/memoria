import { openPhoneProperties } from './mobile-panel-navigation'
import { expect, test, type Page } from '@playwright/test'
import { createTitledNoteFromQuickOpen } from './mobile-note-create-actions'
import { workspaceScenarioForId } from '../src/fixtures/workspaceFixtures'
import {
  HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY,
  HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY,
  HOST_WORKSPACE_SNAPSHOT_STORAGE_KEY,
} from '../src/workspace/readOnlyWorkspaceRepository'
import { applyMobileWorkspaceEdit } from '../src/workspace/mobileWorkspaceEditing'

test.describe('phone property action parity', () => {
  test('adds, edits, and deletes typed properties from the phone properties panel', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-portrait', 'Phone property actions run on the phone properties surface.')

    await page.goto('/')
    await createPhonePropertyNote(page)
    await openPhoneProperties(page)
    await createTypeFromMissingTypeWarning(page)
    await addNumberProperty(page)
    await addBooleanProperty(page)
    await addUrlProperty(page)
    await addColorProperty(page)
    await addDateProperty(page)
    await editTagListProperty(page)
    await editStatusProperty(page)
    await deleteProperty(page, 'published')
  })

  test('matches desktop frontmatter state prompts from phone properties', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-portrait', 'Phone property prompts run on the phone properties surface.')

    await installSelectedHostWorkspace(page, '# Phone Body Only Properties\n\nNo properties yet.\n')
    await page.goto('/?source=host-vault&phoneState=properties')
    await expect(page.getByTestId('phone-properties-screen')).toBeVisible()
    await expect(page.getByTestId('properties-initialize-frontmatter')).toContainText('This note has no properties yet')

    await page.getByText('Initialize properties').click()
    await expect(page.getByTestId('property-row-type')).toContainText('Note')
    await expect(page.getByTestId('properties-initialize-frontmatter')).toBeHidden()
  })

  test('opens invalid phone frontmatter in the source editor', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-portrait', 'Phone invalid-frontmatter prompts run on the phone properties surface.')

    await installSelectedHostWorkspace(page, '---\nnot yaml\n---\n# Invalid Mobile Properties\n')
    await page.goto('/?source=host-vault&phoneState=properties')
    await expect(page.getByTestId('phone-properties-screen')).toBeVisible()
    await expect(page.getByTestId('properties-invalid-frontmatter')).toContainText('Invalid properties')

    await page.getByText('Fix in editor').click()
    await expect(page.getByTestId('phone-editor-screen')).toBeVisible()
    await expect(page.getByTestId('editor-markdown-input')).toBeVisible()
    await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/not yaml/u)
  })
})

async function createPhonePropertyNote(page: Page) {
  await createTitledNoteFromQuickOpen(page, 'Phone Property Matrix')
  await page.getByTestId('note-row-phone-property-matrix.md').click()
  await expect(page.getByTestId('phone-editor-screen')).toBeVisible()
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText('phone-property-matrix.md')
}

async function installSelectedHostWorkspace(page: Page, selectedNoteContent: string) {
  const baseSnapshot = workspaceScenarioForId('default')
  const noteId = baseSnapshot.selectedNoteId ?? baseSnapshot.notes[0]?.id
  const snapshot = noteId
    ? applyMobileWorkspaceEdit(baseSnapshot, {
      noteId,
      rawContent: selectedNoteContent,
      type: 'hydrateNoteContent',
    })
    : baseSnapshot
  const selectedNote = snapshot.notes.find((note) => note.id === snapshot.selectedNoteId) ?? snapshot.notes[0]
  const noteContents = selectedNote?.path ? { [selectedNote.path]: selectedNoteContent } : {}

  await page.addInitScript(
    ({ contentKey, globalKey, key, noteContents, snapshot, value }) => {
      Reflect.set(window, globalKey, snapshot)
      Reflect.set(window, contentKey, noteContents)
      window.localStorage.setItem(key, value)
    },
    {
      contentKey: HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY,
      globalKey: HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY,
      key: HOST_WORKSPACE_SNAPSHOT_STORAGE_KEY,
      noteContents,
      snapshot,
      value: JSON.stringify(snapshot),
    },
  )
}

async function createTypeFromMissingTypeWarning(page: Page) {
  await page.getByTestId('property-row-type-edit').click()
  await expect(page.getByTestId('workspace-action-sheet-changeNoteType')).toBeVisible()
  await page.getByTestId('workspace-change-type-input').fill('Hotel')
  await page.getByTestId('workspace-action-sheet-changeNoteType').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId('property-row-type')).toContainText('Hotel')
  await expect(page.getByTestId('missing-type-warning')).toBeVisible()

  await page.getByTestId('missing-type-warning').click()
  await expect(page.getByTestId('workspace-action-sheet-createType')).toBeVisible()
  await expect(page.getByTestId('workspace-create-type-name-input')).toHaveValue('Hotel')
  await page.getByTestId('workspace-action-sheet-createType').getByRole('button', { name: 'Create' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
}

async function addNumberProperty(page: Page) {
  await addProperty(page, 'Estimate', async () => {
    await page.getByTestId('workspace-property-kind-number').click()
    await page.getByTestId('workspace-property-value-input').fill('13')
  })
  await expect(page.getByTestId('property-row-estimate')).toContainText('13')
}

async function addBooleanProperty(page: Page) {
  await addProperty(page, 'Published', async () => {
    await page.getByTestId('workspace-property-kind-boolean').click()
    await expect(page.getByTestId('workspace-property-boolean-picker')).toBeVisible()
    await page.getByTestId('workspace-property-boolean-no').click()
  })
  await expect(page.getByTestId('property-row-published')).toContainText('No')
}

async function addUrlProperty(page: Page) {
  await addProperty(page, 'URL', async () => {
    await expect(page.getByTestId('workspace-property-kind-url')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('workspace-property-value-input')).toHaveAttribute('placeholder', 'https://')
    await page.getByTestId('workspace-property-value-input').fill('https://memoria.app')
  })
  await expect(page.getByTestId('property-row-url')).toContainText('https://memoria.app')
}

async function addColorProperty(page: Page) {
  await addProperty(page, 'Brand color', async () => {
    await expect(page.getByTestId('workspace-property-kind-color')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('workspace-property-color-picker')).toBeVisible()
    await page.getByTestId('workspace-property-color-blue').click()
  })
  await expect(page.getByTestId('property-row-brand-color')).toContainText('#155DFF')
}

async function addDateProperty(page: Page) {
  await addProperty(page, 'Date', async () => {
    await expect(page.getByTestId('workspace-property-kind-date')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('workspace-property-value-input')).toHaveAttribute('placeholder', 'YYYY-MM-DD')
    await page.getByTestId('workspace-property-value-input').fill('2026-06-20')
  })
  await expect(page.getByTestId('property-row-date')).toContainText('June 20, 2026')

  await page.getByTestId('property-row-date-edit').click()
  await expect(page.getByTestId('workspace-action-sheet-editProperty')).toBeVisible()
  await expect(page.getByTestId('workspace-action-sheet-toolbar')).toContainText('Date')
  await page.getByTestId('workspace-property-value-input').fill('2026-06-21')
  await savePropertySheet(page, 'editProperty')
  await expect(page.getByTestId('property-row-date')).toContainText('June 21, 2026')
}

async function editTagListProperty(page: Page) {
  await page.getByTestId('property-tags-edit').scrollIntoViewIfNeeded()
  await page.getByTestId('property-tags-edit').click()
  await expect(page.getByTestId('workspace-action-sheet-editProperty')).toBeVisible()
  await expect(page.getByTestId('workspace-action-sheet-toolbar')).toContainText('tags')
  await expect(page.getByTestId('workspace-property-kind-list')).toBeHidden()
  await page.getByTestId('workspace-property-value-input').fill('Mobile, De')
  await page.getByTestId('workspace-property-value-suggestion-design').click()
  await expect(page.getByTestId('workspace-property-value-input')).toHaveValue('Mobile, Design')
  await savePropertySheet(page, 'editProperty')
  await expect(page.getByTestId('property-tags-wrap')).toContainText('Mobile')
  await expect(page.getByTestId('property-tags-wrap')).toContainText('Design')
}

async function editStatusProperty(page: Page) {
  await page.getByTestId('property-placeholder-suggested-status').scrollIntoViewIfNeeded()
  await page.getByTestId('property-placeholder-suggested-status').click()
  await expect(page.getByTestId('workspace-action-sheet-addProperty')).toBeVisible()
  await expect(page.getByTestId('workspace-property-name-input')).toHaveValue('Status')
  await expect(page.getByTestId('workspace-property-status-picker')).toBeVisible()
  await page.getByTestId('workspace-property-value-input').fill('Active')
  await savePropertySheet(page, 'addProperty')
  await expect(page.getByTestId('property-row-status')).toContainText('Active')
}

async function deleteProperty(page: Page, propertyKey: string) {
  await page.getByTestId(`property-row-${propertyKey}`).scrollIntoViewIfNeeded()
  await page.getByTestId(`property-row-${propertyKey}-edit`).click()
  await expect(page.getByTestId('workspace-action-sheet-editProperty')).toBeVisible()
  await page.getByTestId('workspace-property-delete-action').click()
  await expect(page.getByTestId(`property-row-${propertyKey}`)).toBeHidden()
}

async function addProperty(page: Page, name: string, fillValue: () => Promise<void>) {
  await page.getByTestId('property-action-add-property').click()
  await expect(page.getByTestId('workspace-action-sheet-addProperty')).toBeVisible()
  await page.getByTestId('workspace-property-name-input').fill(name)
  await fillValue()
  await savePropertySheet(page, 'addProperty')
}

async function savePropertySheet(page: Page, action: 'addProperty' | 'editProperty') {
  await page.getByTestId(`workspace-action-sheet-${action}`).getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
}
