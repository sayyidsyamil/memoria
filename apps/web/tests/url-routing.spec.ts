import { expect, type Page, test } from "@playwright/test";
import { COLLAB_TOKEN } from "../playwright.config";

/**
 * TOL-175: the web URL names the open vault and note. A reload keeps the note, a shared URL
 * opens it in a browser that never saw the vault, and back/forward walk the notes opened.
 */

/** The phone stack shows one pane; phone-layout.spec.ts covers its back navigation (TOL-193). */
const PHONE_PROJECTS = ["iphone-15"];

const NOTES = {
	welcome: { path: "welcome.md", title: "Welcome", body: "A throwaway vault" },
	ada: { path: "people/ada.md", title: "Ada", body: "Works on" },
	heron: { path: "projects/heron.md", title: "Heron", body: "Owned by" },
} as const;

type SeededNote = (typeof NOTES)[keyof typeof NOTES];

async function openRemoteVault(page: Page, url = "/"): Promise<void> {
	await page.addInitScript((token) => {
		window.MEMORIA_REMOTE_URL = window.location.origin;
		window.MEMORIA_REMOTE_TOKEN = token;
	}, COLLAB_TOKEN);
	await page.goto(url);
}

function routeParam(page: Page, key: string): string | null {
	return new URL(page.url()).searchParams.get(key);
}

async function openFromList(page: Page, note: SeededNote): Promise<void> {
	await page
		.getByTestId("note-list-container")
		.getByText(note.title, { exact: true })
		.click();
	await expectOpenNote(page, note);
}

async function expectOpenNote(page: Page, note: SeededNote): Promise<void> {
	await expect.poll(() => routeParam(page, "note")).toBe(note.path);
	await expect(page.locator(".bn-editor")).toContainText(note.body, {
		timeout: 10_000,
	});
}

test("reloading keeps the open note, and the URL names its vault", async ({
	page,
}) => {
	await openRemoteVault(page);
	await openFromList(page, NOTES.ada);
	expect(routeParam(page, "vault")).toBeTruthy();
	const noteUrl = page.url();

	await page.reload();

	await expectOpenNote(page, NOTES.ada);
	expect(page.url()).toBe(noteUrl);
});

test("a shared URL opens the same note in a browser that never opened it", async ({
	page,
}, testInfo) => {
	await openRemoteVault(page, `/?note=${NOTES.heron.path}`);

	await expectOpenNote(page, NOTES.heron);
	if (PHONE_PROJECTS.includes(testInfo.project.name)) {
		await page.getByTestId("phone-back-to-notes").click();
	}
	await expect(
		page
			.getByTestId("note-list-container")
			.getByText(NOTES.welcome.title, { exact: true }),
	).toBeVisible();
});

test("a shared URL wins over the note that was open last", async ({ page }) => {
	await openRemoteVault(page);
	await openFromList(page, NOTES.welcome);

	await page.goto(`/?note=${NOTES.ada.path}`);

	await expectOpenNote(page, NOTES.ada);
});

test("back and forward walk the notes opened", async ({ page }, testInfo) => {
	test.skip(
		PHONE_PROJECTS.includes(testInfo.project.name),
		"the phone goes back to the list between notes",
	);
	await openRemoteVault(page);
	await openFromList(page, NOTES.welcome);
	await openFromList(page, NOTES.ada);
	await openFromList(page, NOTES.heron);

	await page.goBack();
	await expectOpenNote(page, NOTES.ada);
	await page.goBack();
	await expectOpenNote(page, NOTES.welcome);
	await page.goForward();
	await expectOpenNote(page, NOTES.ada);
	await page.goForward();
	await expectOpenNote(page, NOTES.heron);
});
