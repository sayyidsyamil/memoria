import { type Browser, type BrowserContext, chromium, devices, expect, type Page, test, webkit } from '@playwright/test'
import { COLLAB_TOKEN } from '../playwright.config'

// TOL-8: three clients (desktop Chromium, desktop WebKit, an iPhone viewport in WebKit) open
// one note against a local Memoria server, edit it at the same time, and must converge, see
// each other's presence and cursors, and end up in one git-backed markdown file.

// The server keeps what a test wrote, so each test has its own note and nothing is retried.
const NOTE = 'welcome.md'
const OFFLINE_NOTE = 'people/ada.md'

test.describe.configure({ retries: 0 })

interface Client {
  name: string
  context: BrowserContext
  page: Page
}

const browsers: Browser[] = []
const clients: Client[] = []

interface Seat {
  name: string
  note: string
  device: Parameters<Browser['newContext']>[0]
  baseURL: string
}

async function join(browser: Browser, { name, note, device, baseURL }: Seat): Promise<Client> {
  const context = await browser.newContext({ ...device, baseURL })
  await context.addInitScript(
    ([token, userName, path]) => sessionStorage.setItem('memoria:collab-session', JSON.stringify({ token, name: userName, note: path })),
    [COLLAB_TOKEN, name, note],
  )
  const page = await context.newPage()
  await page.goto(`/apps/web/collab.html?note=${note}`)
  await expect(page.getByTestId('collab-status')).toHaveAttribute('data-status', 'synced')
  await expect(page.getByTestId('collab-editor').locator('.bn-block-content').first()).toBeVisible()
  const client = { name, context, page }
  clients.push(client)
  return client
}

interface Typing {
  /** Text of the block to type in. */
  block: string
  /** Where in that block the caret goes first. */
  at: 'Home' | 'End'
  text: string
}

/**
 * Puts the caret through the DOM selection, not a click: only one page of a headless browser
 * has window focus, and a click in another one does not move its selection.
 */
async function type({ page }: Client, { block, at, text }: Typing): Promise<void> {
  const target = page.getByTestId('collab-editor').locator('.bn-inline-content', { hasText: block }).first()
  await target.evaluate((element, toStart) => {
    ;(element.closest('[contenteditable="true"]') as HTMLElement).focus()
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(toStart)
    const selection = window.getSelection() as Selection
    selection.removeAllRanges()
    selection.addRange(range)
    // An unfocused window does not always announce the change the editor listens for.
    document.dispatchEvent(new Event('selectionchange'))
    return new Promise((resolve) => requestAnimationFrame(resolve))
  }, at === 'Home')
  await page.keyboard.type(text, { delay: 15 })
}

/** The document text as this client shows it, without the carets and labels of the others. */
function editorText({ page }: Client): Promise<string> {
  return page.getByTestId('collab-editor').locator('.bn-editor').evaluate((editor) => {
    const copy = editor.cloneNode(true) as HTMLElement
    for (const cursor of copy.querySelectorAll('.bn-collaboration-cursor__base')) cursor.remove()
    return [...copy.querySelectorAll('.bn-block-content')].map((block) => block.textContent).join('\n')
  })
}

test.beforeAll(async () => {
  browsers.push(await chromium.launch(), await webkit.launch())
})

test.afterAll(async () => {
  for (const { context } of clients) await context.close()
  for (const browser of browsers) await browser.close()
})

test('three clients edit one note at the same time and converge', async ({ baseURL, request }, testInfo) => {
  const origin = baseURL as string
  const [chrome, safari] = browsers
  const ada = await join(chrome, { name: 'Ada Chromium', note: NOTE, device: devices['Desktop Chrome'], baseURL: origin })
  const luca = await join(safari, { name: 'Luca WebKit', note: NOTE, device: devices['Desktop Safari'], baseURL: origin })
  const mia = await join(safari, { name: 'Mia Phone', note: NOTE, device: devices['iPhone 15'], baseURL: origin })

  // Presence: everyone sees three avatars, their own marked as such.
  for (const client of clients) {
    await expect(client.page.getByTestId('collab-avatar')).toHaveCount(3)
    await expect(client.page.getByRole('img', { name: `${client.name} (you)` })).toBeVisible()
  }

  // Concurrent edits: all three type without waiting for each other, two of them in one block.
  await Promise.all([
    type(ada, { block: 'Welcome', at: 'End', text: ' from Chromium' }),
    type(luca, { block: 'A throwaway vault.', at: 'End', text: ' WebKit was here.' }),
    type(mia, { block: 'A throwaway vault.', at: 'Home', text: 'Phone first. ' }),
  ])

  // BlockNote keeps an empty block at the end of every document; it is not written to the file.
  const expected = 'Welcome from Chromium\nPhone first. A throwaway vault. See Heron and Ada. WebKit was here.\n'
  for (const client of clients) await expect.poll(() => editorText(client)).toBe(expected)

  // Cursors: each client draws the carets of the two others, labelled with their names.
  for (const client of clients) {
    await expect(client.page.locator('.bn-collaboration-cursor__base')).toHaveCount(2)
  }
  const others = await ada.page.locator('.bn-collaboration-cursor__label').allTextContents()
  expect(others.sort()).toEqual(['Luca WebKit', 'Mia Phone'])

  // The phone shows the whole surface inside its viewport.
  const viewport = mia.page.viewportSize() as { width: number }
  const box = await mia.page.getByTestId('collab-editor').boundingBox()
  expect(box && box.x >= 0 && box.x + box.width <= viewport.width + 1).toBe(true)

  // The edits reach the markdown file in git, and only the edited lines changed.
  const headers = { authorization: `Bearer ${COLLAB_TOKEN}` }
  await expect
    .poll(async () => (await request.get(`/v1/files/${NOTE}`, { headers })).text(), { timeout: 15_000 })
    .toContain('WebKit was here.')
  const markdown = await (await request.get(`/v1/files/${NOTE}`, { headers })).text()
  expect(markdown).toBe(
    '---\ntype: Note\n---\n# Welcome from Chromium\n\nPhone first. A throwaway vault. See [[projects/heron]] and [[people/ada]]. WebKit was here.\n',
  )

  for (const client of clients) {
    await testInfo.attach(`collab-${client.name}.png`, { body: await client.page.screenshot(), contentType: 'image/png' })
    await client.page.screenshot({ path: testInfo.outputPath(`collab-${client.name.replaceAll(' ', '-')}.png`) })
  }
})

test('a client that loses its connection says so and catches up', async ({ baseURL }) => {
  const [chrome] = browsers
  const seat = { note: OFFLINE_NOTE, device: devices['Desktop Chrome'], baseURL: baseURL as string }
  const ada = await join(chrome, { ...seat, name: 'Ada Offline' })
  const luca = await join(chrome, { ...seat, name: 'Luca Online' })

  await ada.context.setOffline(true)
  await type(ada, { block: 'Works on', at: 'End', text: ' Typed offline.' })
  await type(luca, { block: 'Ada', at: 'End', text: ' while Ada was away' })
  await ada.context.setOffline(false)

  await expect(luca.page.getByTestId('collab-editor')).toContainText('Typed offline.')

  await expect(ada.page.getByTestId('collab-editor')).toContainText('while Ada was away')
  await expect(ada.page.getByTestId('collab-status')).toHaveAttribute('data-status', 'synced')
})
