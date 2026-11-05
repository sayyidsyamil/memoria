import { phoneBack } from './mobile-panel-navigation'
import { expect, test, type Page } from '@playwright/test'
import { MOBILE_ATTACHMENT_IMPORTS_GLOBAL_KEY } from '../src/workspace/mobileAttachmentImport'
import { createTitledNoteFromQuickOpen } from './mobile-note-create-actions'

test.describe('phone editor command parity', () => {
  test('exercises phone source editor autocomplete and formatting commands', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-portrait', 'Phone editor command checks run on the phone editor shell.')

    await page.goto('/')
    await createPhonePersonNote(page)
    await createPhoneCommandDraft(page)
    await insertPhonePersonMention(page)
    await insertPhoneWikilink(page)
    await insertPhoneEmojiShortcode(page)
    await assertPhoneSourceFrontmatterWarning(page)
    await applyPhoneFormattingCommands(page)
    await assertRenderedPhoneMarkdown(page)
  })
})

async function createPhonePersonNote(page: Page) {
  await createPhoneNote(page, 'Phone Person Target')
  await page.getByTestId('editor-source-action').click()
  const input = page.getByTestId('editor-markdown-input')
  await input.fill('---\ntype: Person\n---\n\n# Phone Person Target')
  await expect(input).toHaveValue(/type: Person/u)
  await phoneBack(page)
  await expect(page.getByTestId('phone-note-list-screen')).toBeVisible()
}

async function assertPhoneSourceFrontmatterWarning(page: Page) {
  const input = page.getByTestId('editor-markdown-input')

  await input.fill('---\ntype: Essay\n\n# Phone Editor Commands')
  await expect(page.getByTestId('editor-markdown-yaml-error')).toContainText('Unclosed frontmatter')
  await input.fill('---\ntype: Essay\n---\n\n# Phone Editor Commands')
  await expect(page.getByTestId('editor-markdown-yaml-error')).toBeHidden()
}

async function createPhoneCommandDraft(page: Page) {
  await createPhoneNote(page, 'Phone Editor Commands')
  await page.getByTestId('editor-source-action').click()
  await expect(page.getByTestId('editor-markdown-input')).toBeVisible()
  await expect(page.getByTestId('editor-formatting-toolbar')).toBeVisible()
}

async function createPhoneNote(page: Page, title: string) {
  await createTitledNoteFromQuickOpen(page, title)
  await page.getByTestId(`note-row-${noteRowSlug(title)}.md`).click()
  await expect(page.getByTestId('phone-editor-screen')).toBeVisible()
  await expectBodyOnlyPhoneNote(page, title)
}

async function insertPhonePersonMention(page: Page) {
  await page.getByTestId('editor-markdown-input').fill('# Phone Editor Commands\n\nFollow up with @pho')
  await expect(page.getByTestId('editor-person-mention-suggestions')).toBeVisible()
  await page.getByTestId('editor-person-mention-suggestion-phone-person-target-md').click()
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue('# Phone Editor Commands\n\nFollow up with [[phone-person-target]] ')
}

async function insertPhoneWikilink(page: Page) {
  await page.getByTestId('editor-markdown-input').fill('# Phone Editor Commands\n\nReference [[open')
  await expect(page.getByTestId('editor-wikilink-suggestions')).toBeVisible()
  await page.getByTestId('editor-wikilink-suggestion-open-source-project').click()
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(
    '# Phone Editor Commands\n\nReference [[Memoria/Mobile UI/How I Run an Open Source Project]]',
  )
}

async function insertPhoneEmojiShortcode(page: Page) {
  await page.getByTestId('editor-markdown-input').fill('# Phone Editor Commands\n\nShip :rock')
  await expect(page.getByTestId('editor-emoji-suggestions')).toBeVisible()
  await page.getByTestId('editor-emoji-suggestion-rocket').click()
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue('# Phone Editor Commands\n\nShip 🚀')
}

async function applyPhoneFormattingCommands(page: Page) {
  const input = page.getByTestId('editor-markdown-input')

  await input.fill('# Phone Editor Commands\n\n')
  await page.getByTestId('editor-format-bold').click()
  await expect(input).toHaveValue(/\*\*bold text\*\*/u)

  await input.fill('# Phone Editor Commands\n\nSection title')
  await page.getByLabel('Headings').click()
  await page.getByTestId('editor-format-heading-2').click()
  await expect(input).toHaveValue(/## Section title/u)

  await input.fill('# Phone Editor Commands\n\n')
  await page.getByTestId('editor-format-link').scrollIntoViewIfNeeded()
  await page.getByTestId('editor-format-link').click()
  await expect(input).toHaveValue('# Phone Editor Commands\n\n[link text](https://)')

  await input.fill('# Phone Editor Commands\n\nPaste: ')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(() => navigator.clipboard.writeText('Plain\nClipboard'))
  await page.getByTestId('editor-format-menu-more').click()
  await page.getByTestId('editor-format-paste-plain-text').click()
  await expect(input).toHaveValue('# Phone Editor Commands\n\nPaste: Plain\nClipboard')

  await input.fill('# Phone Editor Commands\n\nAttachment: ')
  await page.evaluate((key) => {
    const target = window as unknown as Record<string, unknown>
    target[key] = {
      mimeType: 'application/pdf',
      name: 'Project Brief.pdf',
      path: 'attachments/project brief.pdf',
    }
  }, MOBILE_ATTACHMENT_IMPORTS_GLOBAL_KEY)
  await page.getByTestId('editor-format-menu-insert').click()
  await page.getByTestId('editor-format-attachment').click()
  await expect(input).toHaveValue('# Phone Editor Commands\n\nAttachment: \n\n[Project Brief.pdf](<attachments/project brief.pdf>)')

  await input.fill('# Phone Editor Commands\n\nFollow up')
  await page.getByTestId('editor-format-menu-lists').click()
  await page.getByTestId('editor-format-task-list').click()
  await expect(input).toHaveValue(/- \[ \] Follow up/u)

  const listDraft = '# Phone Editor Commands\n\n- One\n- Two'
  await input.fill(listDraft)
  await page.getByTestId('editor-format-menu-lists').click()
  await page.getByTestId('editor-format-indent').click()
  await expect(input).toHaveValue('# Phone Editor Commands\n\n- One\n  - Two')
  await page.getByTestId('editor-format-menu-lists').click()
  await page.getByTestId('editor-format-outdent').click()
  await expect(input).toHaveValue(listDraft)

  await input.fill('# Phone Editor Commands\n\n')
  await page.getByTestId('editor-format-menu-insert').click()
  await page.getByTestId('editor-format-table').click()
  await expect(input).toHaveValue(/\| Column \| Value \|/u)

  await input.fill('# Phone Editor Commands\n\n/table')
  await expect(page.getByTestId('editor-slash-command-suggestions')).toBeHidden()
  await expect(input).toHaveValue('# Phone Editor Commands\n\n/table')

  await input.fill('# Phone Editor Commands\n\n')
  await page.getByTestId('editor-format-menu-insert').click()
  await page.getByTestId('editor-format-math-block').click()
  await expect(input).toHaveValue('# Phone Editor Commands\n\n$$\n\\sqrt{a^2 + b^2}\n$$')

  await input.fill('# Phone Editor Commands\n\n')
  await page.getByTestId('editor-format-menu-insert').click()
  await page.getByTestId('editor-format-mermaid').click()
  await expect(input).toHaveValue('# Phone Editor Commands\n\n```mermaid\nflowchart TD\n    edit["Switch to the raw editor to edit"]\n```')
}

async function assertRenderedPhoneMarkdown(page: Page) {
  const input = page.getByTestId('editor-markdown-input')
  await input.fill([
    '# Phone Editor Commands',
    '',
    'Follow up with [[phone-person-target]] and [[Memoria/Mobile UI/How I Run an Open Source Project]].',
    '',
    '## Section title',
    '',
    '- [ ] Follow up',
    '',
    '| Column | Value |',
    '| --- | --- |',
    '| Phone | Parity |',
  ].join('\n'))
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText('phone-editor-commands.md')
  await expect(input).toHaveValue(/\[\[phone-person-target\]\]/u)
  await expect(input).toHaveValue(/\[\[Memoria\/Mobile UI\/How I Run an Open Source Project\]\]/u)
  await expect(input).toHaveValue(/## Section title/u)
  await expect(input).toHaveValue(/- \[ \] Follow up/u)
  await expect(input).toHaveValue(/\| Phone \| Parity \|/u)
  await page.waitForTimeout(300)
}

async function expectBodyOnlyPhoneNote(page: Page, title: string) {
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText(`${noteRowSlug(title)}.md`)
  await expect(page.getByTestId('editor-title')).toBeHidden()
}

function noteRowSlug(title: string) {
  return title.trim().toLowerCase().replace(/\s+/gu, '-')
}
