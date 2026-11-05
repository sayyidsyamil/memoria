import {
	type APIRequestContext,
	expect,
	type Page,
	test,
} from "@playwright/test";
import { COLLAB_TOKEN } from "../playwright.config";

/**
 * TOL-221: Raw mode on a live-bound web note edits the note's live document. Raw edits show
 * in the rich editor and rich edits in the raw editor, the server writes them to the file,
 * and they survive a reload. Nothing is written through the files API: that side channel
 * would race the server writing the document.
 */

// offline.spec.ts and url-routing.spec.ts only read this note's first body line.
const NOTE_PATH = "projects/heron.md";
const NOTE_TITLE = "Heron";
const BODY_LINE = "Owned by";
const AUTH = { authorization: `Bearer ${COLLAB_TOKEN}` };
// Phones and tablets lay the breadcrumb toolbar out differently.
const DESKTOP_PROJECTS = ["chromium", "webkit"];

test.describe.configure({ retries: 0 });

async function configureRemoteVault(page: Page): Promise<void> {
	await page.addInitScript((token) => {
		window.MEMORIA_REMOTE_URL = window.location.origin;
		window.MEMORIA_REMOTE_TOKEN = token;
	}, COLLAB_TOKEN);
}

async function serverContent(request: APIRequestContext): Promise<string> {
	const response = await request.get(`/v1/files/${NOTE_PATH}`, {
		headers: AUTH,
	});
	expect(response.status()).toBe(200);
	return response.text();
}

function occurrences(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

function richEditor(page: Page) {
	return page.locator(".bn-editor");
}

function rawEditor(page: Page) {
	return page.locator(".cm-content");
}

async function openNote(page: Page): Promise<void> {
	await page.goto("/", { waitUntil: "load" });
	const noteList = page.getByTestId("note-list-container");
	await expect(noteList.getByText(NOTE_TITLE, { exact: true })).toBeVisible({
		timeout: 10_000,
	});
	await noteList.getByText(NOTE_TITLE, { exact: true }).click();
	await expect(
		richEditor(page).locator(".bn-inline-content", { hasText: BODY_LINE }).first(),
	).toBeVisible({ timeout: 10_000 });
}

async function openRawEditor(page: Page): Promise<void> {
	await page.getByRole("button", { name: "Open the raw editor", exact: true }).click();
	await expect(rawEditor(page)).toBeVisible({ timeout: 10_000 });
}

async function returnToRichEditor(page: Page): Promise<void> {
	await page.getByRole("button", { name: "Return to the editor", exact: true }).click();
	await expect(rawEditor(page)).toBeHidden({ timeout: 10_000 });
}

/** Types a new last line into the raw editor. */
async function appendRawLine(page: Page, line: string): Promise<void> {
	await rawEditor(page).click();
	await page.keyboard.press("ControlOrMeta+End");
	await page.keyboard.press("Enter");
	await page.keyboard.type(line);
}

/** Types a new property after the first one, in the raw editor. */
async function addRawProperty(page: Page, line: string): Promise<void> {
	await rawEditor(page).click();
	await page.keyboard.press("ControlOrMeta+Home");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("End");
	await page.keyboard.press("Enter");
	await page.keyboard.type(line);
}

function frontmatterOf(file: string): string {
	return file.slice(0, file.indexOf("\n---\n", 4) + 5);
}

async function expectRichShowsOnce(page: Page, text: string): Promise<void> {
	await expect
		.poll(async () => occurrences((await richEditor(page).textContent()) ?? "", text), {
			timeout: 10_000,
		})
		.toBe(1);
}

async function expectRawShowsOnce(page: Page, text: string): Promise<void> {
	await expect
		.poll(async () => occurrences((await rawEditor(page).textContent()) ?? "", text), {
			timeout: 10_000,
		})
		.toBe(1);
}

async function expectServerHasOnce(request: APIRequestContext, text: string): Promise<void> {
	await expect
		.poll(async () => occurrences(await serverContent(request), text), { timeout: 20_000 })
		.toBe(1);
}

function recordFileWrites(page: Page): string[] {
	const writes: string[] = [];
	page.on("request", (sent) => {
		if (sent.method() === "PUT" && sent.url().includes("/v1/files/")) writes.push(sent.url());
	});
	return writes;
}

test("raw and rich edits of a live note reach the file and survive a reload", async ({
	page,
	request,
}, testInfo) => {
	test.skip(!DESKTOP_PROJECTS.includes(testInfo.project.name), "desktop layouts only");
	// One server serves every project of the run: each edits with its own markers.
	const run = `${testInfo.project.name}-${Date.now()}`;
	const rawLine = `Raw line tol221-${run}`;
	const richMarker = ` rich-tol221-${run}`;
	const secondRawLine = `Second raw line tol221-${run}`;
	const property = `reviewed-${testInfo.project.name}: "${run}"`;
	await configureRemoteVault(page);
	const fileWrites = recordFileWrites(page);
	await openNote(page);

	// Raw to rich: the raw edit is in the live document the rich editor shows.
	await openRawEditor(page);
	await appendRawLine(page, rawLine);
	await addRawProperty(page, property);
	await returnToRichEditor(page);
	await expectRichShowsOnce(page, rawLine);
	await expectServerHasOnce(request, rawLine);
	expect(frontmatterOf(await serverContent(request))).toContain(`\n${property}\n`);

	// Rich to raw: the rich edit shows in the raw editor, which edits on top of it.
	await richEditor(page).locator(".bn-inline-content", { hasText: rawLine }).first().click();
	await page.keyboard.press("End");
	await page.keyboard.type(richMarker);
	await openRawEditor(page);
	await expectRawShowsOnce(page, `${rawLine}${richMarker}`);
	await expectRawShowsOnce(page, property);
	await appendRawLine(page, secondRawLine);
	await returnToRichEditor(page);
	await expectRichShowsOnce(page, secondRawLine);
	await expectRichShowsOnce(page, `${rawLine}${richMarker}`);
	await expectServerHasOnce(request, secondRawLine);
	await expectServerHasOnce(request, `${rawLine}${richMarker}`);
	expect(fileWrites, "the edits went through the live document").toEqual([]);

	// The edits live in the note's document and its file: a reload shows each of them once.
	await page.reload({ waitUntil: "load" });
	await openNote(page);
	await expectRichShowsOnce(page, `${rawLine}${richMarker}`);
	await expectRichShowsOnce(page, secondRawLine);
	await openRawEditor(page);
	await expectRawShowsOnce(page, `${rawLine}${richMarker}`);
	await expectRawShowsOnce(page, secondRawLine);
	await expectRawShowsOnce(page, property);
	// The edits changed only their own lines: the file keeps its layout (TOL-222).
	const file = await serverContent(request);
	expect(file.startsWith("---\ntype: Project\n")).toBe(true);
	expect(file).toContain("status: Active\n");
	expect(file).toContain("\n---\n# Heron\n\nOwned by [[people/ada]].");
	expect(frontmatterOf(file)).toContain(`\n${property}\n`);
	expect(occurrences(file, BODY_LINE)).toBe(1);
});
