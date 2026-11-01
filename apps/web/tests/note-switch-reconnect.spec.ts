import {
	type APIRequestContext,
	expect,
	type Page,
	type TestInfo,
	test,
} from "@playwright/test";
import { COLLAB_TOKEN } from "../playwright.config";

/**
 * TOL-230: a WebKit page that has just left a live note opens the next one too. Two notes
 * link to each other and the page follows the links back and forth; every note it lands on
 * gets to "synced", never stays on "Connecting…". Before the fix, cancelling the body of a
 * note read the service worker served stalled the page's next ticket request.
 */

// The stall needs the service worker: it served the note read whose body was cancelled.
test.use({ serviceWorkers: "allow" });
// A stall must fail the run, not pass on a retry.
test.describe.configure({ retries: 0 });

const AUTH = { authorization: `Bearer ${COLLAB_TOKEN}` };
const SWITCHES = 30;
/** Opening a note waits on its ticket and its socket; the box may be busy. */
const CONNECT_MS = 10_000;
const WEBKIT_PROJECTS = new Set(["webkit", "iphone-15"]);

interface LinkedNote {
	path: string;
	title: string;
	/** The wikilink target of the other note. */
	other: string;
}

test.beforeEach(() => {
	test.skip(
		!WEBKIT_PROJECTS.has(test.info().project.name),
		"the stall was only seen in WebKit, on desktop and iPhone",
	);
});

function linkedNotes(testInfo: TestInfo): [LinkedNote, LinkedNote] {
	const folder = `switch-${testInfo.project.name}-${Date.now()}`;
	return [
		{
			path: `${folder}/first.md`,
			title: `First ${folder}`,
			other: `${folder}/second`,
		},
		{
			path: `${folder}/second.md`,
			title: `Second ${folder}`,
			other: `${folder}/first`,
		},
	];
}

async function createNote(
	request: APIRequestContext,
	{ path, title, other }: LinkedNote,
): Promise<void> {
	const response = await request.put(`/v1/files/${path}`, {
		headers: { ...AUTH, "if-none-match": "*" },
		data: `# ${title}\n\nGo to [[${other}]].\n`,
	});
	expect(response.status()).toBe(201);
}

/** Deletes a note this test made, so the shared vault's note list stays as the other specs expect. */
async function deleteNote(
	request: APIRequestContext,
	{ path }: LinkedNote,
): Promise<void> {
	const read = await request.get(`/v1/files/${path}`, { headers: AUTH });
	const etag = read.headers().etag;
	if (!read.ok() || !etag) return;
	await request.delete(`/v1/files/${path}`, {
		headers: { ...AUTH, "if-match": etag },
	});
}

async function expectConnected(page: Page, { title }: LinkedNote) {
	await expect(page.locator(".bn-editor h1").first()).toContainText(title, {
		timeout: CONNECT_MS,
	});
	await expect(page.getByTestId("status-sync-pill")).toHaveAttribute(
		"data-state",
		"synced",
		{ timeout: CONNECT_MS },
	);
}

/** Follows the note's link to the other note by the keyboard, as the presence spec does. */
async function followLink(page: Page, { other }: LinkedNote) {
	await page.locator(`.bn-editor .wikilink[data-target="${other}"]`).focus();
	await page.keyboard.press("Enter");
}

test("switching between live notes reconnects every time", async ({
	page,
	request,
}, testInfo) => {
	test.setTimeout(90_000);
	const notes = linkedNotes(testInfo);
	await Promise.all(notes.map((note) => createNote(request, note)));
	try {
		await page.addInitScript((token) => {
			window.MEMORIA_REMOTE_URL = window.location.origin;
			window.MEMORIA_REMOTE_TOKEN = token;
		}, COLLAB_TOKEN);
		await page.goto(`/?note=${encodeURIComponent(notes[0].path)}`);
		await expectConnected(page, notes[0]);
		for (let step = 1; step <= SWITCHES; step++) {
			await followLink(page, notes[(step - 1) % 2]);
			await expectConnected(page, notes[step % 2]);
		}
	} finally {
		await Promise.all(notes.map((note) => deleteNote(request, note)));
	}
});
