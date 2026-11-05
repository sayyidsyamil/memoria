import { expect, test } from '@playwright/test'
import { HOST_WORKSPACE_WRITE_FAILURE_GLOBAL_KEY } from '../src/workspace/readOnlyWorkspaceRepository'
import { createRenameAndDeleteTypeSection, customizeProcedureTypeSection } from './mobile-type-section-flows'
import { createTitledNoteFromQuickOpen } from './mobile-note-create-actions'
import { searchAndSelectRelease, toggleFavorite, retargetSelectedRelease, createMobileQaDraft, toggleSelectedNoteWidth, expectSelectedBodyOnlyNoteTitle, createNote, changeSelectedNoteTypeTo, insertPersonMention, renameSelectedFileToTitle } from './mobile-workspace-property-flows'
import { createSavedViewFromSidebar, editAndDeleteSavedView, moveCreatedSavedView, addPrioritySortFixtures, customizeCreatedSavedViewColumns, customizeAllNotesColumns, bulkSelectDefaultNotes, navigatePhoneSidebarSection, openPhoneEditorAndProperties, editPhoneProperty, editPhoneMarkdownWithWikilink, returnPhoneEditorToList, navigatePhoneSwipeGestures } from './mobile-workspace-navigation-flows'
import { addDatePropertyFromSuggestion, addRelationshipFromSuggestion, editMarkdownWithWikilink, archiveAndUnarchiveSelectedNote, organizeUnorganizeAndDeleteSelectedDraft, createRenameAndDeleteSidebarFolder, replaceSelectedNoteMarkdown, tableOfContentsNavigationMarkdown, editorScrollTop, editRawFrontmatterContract } from './mobile-workspace-document-flows'
import { installRequiredLocalVaultSnapshot, assertSnapshotBuildBudgets, assertLocalVaultRenderBudget, assertNoteSwitchBudget, assertHiddenNoteHydrationAndWrite, assertSavedViewNavigationBudget, assertTypeNavigationBudget, assertFolderNavigationBudget, installFixtureHostWorkspace, hostWorkspaceWriteCount } from './mobile-workspace-vault-flows'

test.describe('mobile UI lab interactions', () => {
  test('exercises editable tablet workspace flows', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Editable action flows use the full-width tablet layout.')

    await page.goto('/')
    await searchAndSelectRelease(page)
    await toggleFavorite(page)
    await retargetSelectedRelease(page)
    await createMobileQaDraft(page)
    await toggleSelectedNoteWidth(page)
    await createSavedViewFromSidebar(page, { returnToInbox: true })
    await addDatePropertyFromSuggestion(page)
    await addRelationshipFromSuggestion(page)
    await editMarkdownWithWikilink(page)
    await archiveAndUnarchiveSelectedNote(page)
    await organizeUnorganizeAndDeleteSelectedDraft(page)
    await createRenameAndDeleteSidebarFolder(page)
  })

  test('navigates quick open search from the keyboard', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Keyboard quick-open checks use the full-width tablet layout.')

    await page.goto('/')
    await page.getByTestId('note-list-search-action').click()
    await expect(page.getByTestId('workspace-search-input')).toBeFocused()
    await expect(page.getByTestId('workspace-search-result-workflow-orchestration')).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
    await expect(page.getByTestId('editor-toolbar-title')).toHaveText('How I Run an Open Source Project.md')
  })

  test('creates a note from an unmatched quick open query', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Quick-open create checks use the full-width tablet layout.')

    const title = 'Quick Open Mobile Draft'

    await page.goto('/')
    await page.getByTestId('note-list-search-action').click()
    await page.getByTestId('workspace-search-input').fill(title)
    await expect(page.getByTestId('workspace-search-results').getByText('No matching notes')).toBeVisible()
    await expect(page.getByTestId('workspace-search-create-note')).toHaveText(`Create note "${title}"`)
    await page.getByTestId('workspace-search-create-note').click()

    await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
    await expect(page.getByTestId('note-row-quick-open-mobile-draft.md')).toBeVisible()
    await expectSelectedBodyOnlyNoteTitle(page, title)
  })

  test('opens the markdown source editor from the editor toolbar', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Editor source mode checks use the full-width tablet layout.')

    await page.goto('/')
    await expect(page.getByTestId('editor-source-action')).toHaveAttribute('aria-label', 'Open the raw editor')
    await page.getByTestId('editor-source-action').click()
    await expect(page.getByTestId('editor-markdown-input')).toBeVisible()
    await expect(page.getByTestId('editor-formatting-toolbar')).toBeVisible()
    await expect(page.getByTestId('editor-source-action')).toHaveAttribute('aria-label', 'Return to the editor')
  })

  test('navigates editor headings from the table of contents sheet', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Table of contents scrolling is exercised in the full-width tablet layout.')

    await page.goto('/')
    await createNote(page, 'TOC Navigation Draft', 'toc-navigation-draft.md')
    await replaceSelectedNoteMarkdown(page, tableOfContentsNavigationMarkdown())

    await expect(editorScrollTop(page)).resolves.toBe(0)
    await page.getByTestId('editor-more-action').click()
    await page.getByTestId('workspace-action-group-edit').click()
    await page.getByTestId('workspace-action-table-of-contents').click()
    await expect(page.getByTestId('table-of-contents-row-toc-heading-0')).toContainText('Target Section')
    await page.getByTestId('table-of-contents-row-toc-heading-0').click()
    await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
    if (await page.getByTestId('editor-markdown-input').isVisible().catch(() => false)) {
      await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/## Target Section/u)
      return
    }
    await expect.poll(() => editorScrollTop(page)).toBeGreaterThan(120)
  })

  test('derives tablet metadata from raw frontmatter edits', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Raw frontmatter parity uses the full-width tablet layout.')

    await page.goto('/')
    await editRawFrontmatterContract(page)
  })

  test('navigates fixture saved views', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Saved-view navigation is exercised in the full-width tablet layout.')

    await page.goto('/')

    await page.getByRole('button', { name: 'Active Procedures' }).click()
    await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Active Procedures')
    await expect(page.getByText('How I Run an Open Source Project').first()).toBeVisible()
    await expect(page.getByTestId('note-row-open-source-project').getByText('Project Board')).toBeVisible()
    await expect(page.getByTestId('note-row-open-source-project').getByText('Process')).toBeVisible()
    await expect(page.getByText('Workflow Orchestration Essay').first()).toBeHidden()
    await editAndDeleteSavedView(page)
  })

  test('reorders created saved views', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Saved-view ordering is exercised in the full-width tablet layout.')

    await page.goto('/')
    await createSavedViewFromSidebar(page, { displayPropertyQuery: 'bel', displayPropertyTestId: 'belongs-to' })
    await moveCreatedSavedView(page)
  })

  test('customizes saved view note-list columns', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Saved-view column editing is exercised in the full-width tablet layout.')

    await page.goto('/')
    await addPrioritySortFixtures(page)
    await createSavedViewFromSidebar(page)
    await customizeCreatedSavedViewColumns(page)
  })

  test('customizes primary note-list columns', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Primary note-list column editing is exercised in the full-width tablet layout.')

    await page.goto('/')
    await addPrioritySortFixtures(page)
    await customizeAllNotesColumns(page)
  })

  test('customizes type section metadata and note-list columns', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Type-section editing is exercised in the full-width tablet layout.')

    await page.goto('/')
    await customizeProcedureTypeSection(page)
  })

  test('creates and deletes Type documents from the sidebar', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Type document actions are exercised in the full-width tablet layout.')

    await page.goto('/')
    await createRenameAndDeleteTypeSection(page)
  })

  test('inserts @ person mentions as canonical wikilinks in the editor', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Editor autocomplete checks use the full-width tablet layout.')

    await page.goto('/')
    await createNote(page, 'Maria Rossi', 'maria-rossi.md')
    await changeSelectedNoteTypeTo(page, 'Person')
    await createNote(page, 'Mention Draft', 'mention-draft.md')
    await insertPersonMention(page)
  })

  test('renames a file to the selected note title from mobile more actions', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Filename retargeting checks use the full-width tablet layout.')

    await page.goto('/')
    await renameSelectedFileToTitle(page)
  })

  test('bulk-selects tablet note-list rows and applies desktop note actions', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Bulk note actions use the full-width tablet layout.')

    await page.goto('/')
    await bulkSelectDefaultNotes(page)
    await expect(page.getByTestId('note-list-bulk-selected-count')).toHaveText('2 selected')
    await page.getByTestId('note-list-bulk-clear').click()
    await expect(page.getByTestId('note-list-bulk-action-bar')).toBeHidden()
    await expect(page.getByTestId('note-row-workflow-orchestration')).toBeVisible()

    await bulkSelectDefaultNotes(page)
    await page.getByTestId('note-list-bulk-archive').click()
    await expect(page.getByTestId('note-row-workflow-orchestration')).toBeHidden()
    await expect(page.getByTestId('note-row-open-source-project')).toBeHidden()

    await page.getByTestId('sidebar-item-archive').click()
    await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Archive')
    await expect(page.getByTestId('note-row-workflow-orchestration')).toBeVisible()
    await bulkSelectDefaultNotes(page)
    await page.getByTestId('note-list-bulk-archive').click()
    await expect(page.getByTestId('note-row-workflow-orchestration')).toBeHidden()

    await page.getByTestId('sidebar-item-inbox').click()
    await expect(page.getByTestId('note-row-workflow-orchestration')).toBeVisible()
    await bulkSelectDefaultNotes(page)
    await page.getByTestId('note-list-bulk-organize').click()
    await expect(page.getByTestId('note-row-workflow-orchestration')).toBeHidden()
    await expect(page.getByTestId('note-row-open-source-project')).toBeHidden()

    await page.getByTestId('sidebar-item-all-notes').click()
    await expect(page.getByTestId('note-row-workflow-orchestration')).toBeVisible()
    await bulkSelectDefaultNotes(page)
    await page.getByTestId('note-list-bulk-delete').click()
    await expect(page.getByTestId('note-row-workflow-orchestration')).toBeHidden()
    await expect(page.getByTestId('note-row-open-source-project')).toBeHidden()
  })

  test('exercises reducer-backed phone workspace flows', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-portrait', 'Phone real-workspace checks run on the phone layout.')

    await page.goto('/')
    await navigatePhoneSidebarSection(page)
    await openPhoneEditorAndProperties(page)
    await editPhoneProperty(page)
    await editPhoneMarkdownWithWikilink(page)
    await returnPhoneEditorToList(page)
    await navigatePhoneSwipeGestures(page)
  })

  test('keeps large local-vault read-only interactions within tablet budgets', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Large-vault performance checks run once on the primary tablet layout.')

    const state = await installRequiredLocalVaultSnapshot(page)
    assertSnapshotBuildBudgets(state)
    await assertLocalVaultRenderBudget(page, state)
    await assertNoteSwitchBudget(page, state)
    await assertHiddenNoteHydrationAndWrite(page, state)
    await assertSavedViewNavigationBudget(page, state)
    await assertTypeNavigationBudget(page, state)
    await assertFolderNavigationBudget(page, state)
  })

  test('retains an editable draft after a host write failure without restoring the footer', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Host persistence checks use the full-width tablet layout.')

    await installFixtureHostWorkspace(page)
    await page.goto('/?source=host-vault')

    await expect(page.getByTestId('editor-toolbar-title')).toHaveText('Workflow Orchestration Essay.md')
    await createTitledNoteFromQuickOpen(page, 'Persistence Warmup Draft')
    await expect(hostWorkspaceWriteCount(page)).resolves.toBe(2)

    await page.evaluate((failureKey) => {
      Reflect.set(window, failureKey, 'Host write failed in QA')
    }, HOST_WORKSPACE_WRITE_FAILURE_GLOBAL_KEY)
    await expect(page.evaluate((failureKey) => {
      return (window as unknown as Record<string, unknown>)[failureKey]
    }, HOST_WORKSPACE_WRITE_FAILURE_GLOBAL_KEY)).resolves.toBe('Host write failed in QA')
    await createTitledNoteFromQuickOpen(page, 'Persistence Failure Draft')

    await expect(page.getByTestId('sync-status-label')).toHaveCount(0)
    await expect(hostWorkspaceWriteCount(page)).resolves.toBe(2)
    await expect(page.getByTestId('editor-toolbar-title')).toHaveText('persistence-failure-draft.md')
    await page.getByTestId('editor-source-action').click()
    await expect(page.getByTestId('editor-markdown-input')).toBeEditable()
    await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/Persistence Failure Draft/u)
  })
})
