import {
	type APIRequestContext,
	expect,
	type Page,
	test,
} from "@playwright/test";
import { COLLAB_TOKEN } from "../playwright.config";

/**
 * TOL-190: an edit typed into the web editor reaches the server through the note's live
 * document, is written to the file, and is still there after a reload, with no duplicated
 * content when the note is open twice.
 */

// One server serves every project of a run, so each project types its own marker into a
// note the collab spec does not touch.
const NOTE_PATH = "journal/2026-10-10.md";
const NOTE_TITLE = "10 October 2026";
const LAST_LINE = "Sketched the sync protocol.";

test.describe.configure({ retries: 0 });

async function configureRemoteVault(page: Page): Promise<void> {
	await page.addInitScript((token) => {
		window.MEMORIA_REMOTE_URL = window.location.origin;
		window.MEMORIA_REMOTE_TOKEN = token;
	}, COLLAB_TOKEN);
}

async function openNote(page: Page): Promise<void> {
	await page.goto("/", { waitUntil: "networkidle" });
	const noteList = page.getByTestId("note-list-container");
	await expect(noteList.getByText(NOTE_TITLE, { exact: true })).toBeVisible({
		timeout: 10_000,
	});
	await noteList.getByText(NOTE_TITLE, { exact: true }).click();
	await expect(lastLine(page)).toBeVisible({ timeout: 10_000 });
}

function editor(page: Page) {
	return page.locator(".bn-editor");
}

function lastLine(page: Page) {
	return editor(page)
		.locator(".bn-inline-content", { hasText: LAST_LINE })
		.first();
}

async function typeAtEndOfLastLine(page: Page, text: string): Promise<void> {
	await lastLine(page).click();
	await page.keyboard.press("End");
	await page.keyboard.type(text);
}

async function serverContent(request: APIRequestContext): Promise<string> {
	const response = await request.get(`/v1/files/${NOTE_PATH}`, {
		headers: { authorization: `Bearer ${COLLAB_TOKEN}` },
	});
	expect(response.status()).toBe(200);
	return response.text();
}

function occurrences(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

async function expectEditorShowsOnce(page: Page, marker: string) {
	await expect
		.poll(
			async () => occurrences((await editor(page).textContent()) ?? "", marker),
			{
				timeout: 10_000,
			},
		)
		.toBe(1);
	await expect
		.poll(async () =>
			occurrences((await editor(page).textContent()) ?? "", LAST_LINE),
		)
		.toBe(1);
}

test("an edit in the web editor is saved to the server and survives a reload", async ({
	page,
	request,
}, testInfo) => {
	const marker = ` tol190-${testInfo.project.name}-${Date.now()}`;
	await configureRemoteVault(page);
	await openNote(page);

	// Git runs on the server: the shell shows its sync pill, not the mock git controls.
	const statusBar = page.getByTestId("status-bar");
	await expect(statusBar).toBeVisible();
	await expect(statusBar.getByTestId("status-sync-pill")).toBeVisible();
	await expect(statusBar).not.toContainText("Not synced");
	await expect(statusBar).not.toContainText("Changes");

	await typeAtEndOfLastLine(page, marker);

	await expect
		.poll(async () => occurrences(await serverContent(request), marker), {
			timeout: 20_000,
		})
		.toBe(1);
	// Earlier projects of the run typed their markers on the same line.
	const editedLine = (await serverContent(request))
		.split("\n")
		.find((line) => line.includes(LAST_LINE));
	expect(editedLine).toContain(marker);

	await page.reload({ waitUntil: "networkidle" });
	await openNote(page);
	await expectEditorShowsOnce(page, marker);

	const second = await page.context().newPage();
	await configureRemoteVault(second);
	await openNote(second);
	await expectEditorShowsOnce(second, marker);
	await expectEditorShowsOnce(page, marker);
	await second.close();

	expect(occurrences(await serverContent(request), marker)).toBe(1);
	expect(occurrences(await serverContent(request), LAST_LINE)).toBe(1);
});
