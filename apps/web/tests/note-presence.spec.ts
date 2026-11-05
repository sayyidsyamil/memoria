import {
	type APIRequestContext,
	type Browser,
	type BrowserContext,
	expect,
	type Page,
	type TestInfo,
	test,
} from "@playwright/test";
import { COLLAB_TOKEN } from "../playwright.config";

/**
 * TOL-17: two windows on one live note see each other: an avatar in the note's bar and the
 * other's caret with its name. A window that switches note, goes offline or closes is gone
 * from the other within 5 s.
 */

const AUTH = { authorization: `Bearer ${COLLAB_TOKEN}` };
const LINE = "A line to stand on.";
/** The card's promise: presence clears this fast once a window has left. */
const LEAVE_MS = 5_000;
/** Joining waits on opening the note and its socket; the box may be busy. */
const JOIN_MS = 15_000;

interface SeededNote {
	path: string;
	title: string;
}

async function createNote(
	request: APIRequestContext,
	path: string,
	content: string,
): Promise<void> {
	const response = await request.put(`/v1/files/${path}`, {
		headers: { ...AUTH, "if-none-match": "*" },
		data: content,
	});
	expect(response.status()).toBe(201);
}

/** Deletes a note this test made, so the shared vault's note list stays as the other specs expect. */
async function deleteNote(
	request: APIRequestContext,
	path: string,
): Promise<void> {
	const read = await request.get(`/v1/files/${path}`, { headers: AUTH });
	const etag = read.headers().etag;
	if (!read.ok() || !etag) return;
	await request.delete(`/v1/files/${path}`, {
		headers: { ...AUTH, "if-match": etag },
	});
}

async function remoteContext(
	browser: Browser,
	testInfo: TestInfo,
): Promise<BrowserContext> {
	const context = await browser.newContext(testInfo.project.use);
	await context.addInitScript((token) => {
		window.MEMORIA_REMOTE_URL = window.location.origin;
		window.MEMORIA_REMOTE_TOKEN = token;
	}, COLLAB_TOKEN);
	return context;
}

/** The note's title shows; another's caret on it adds its name label to the heading's text. */
async function expectNoteShown(page: Page, title: string): Promise<void> {
	await expect(page.locator(".bn-editor h1").first()).toContainText(title, {
		timeout: JOIN_MS,
	});
}

/** Opens a note by its deep link (TOL-175): the list holds every other project's notes too. */
async function openNote(
	page: Page,
	{ path, title }: SeededNote,
): Promise<void> {
	await page.goto(`/?note=${encodeURIComponent(path)}`, { waitUntil: "load" });
	await expectNoteShown(page, title);
}

function avatars(page: Page) {
	return page.getByTestId("note-presence-avatar");
}

function remoteCursors(page: Page) {
	return page.locator('.bn-editor [data-testid="collab-cursor"]');
}

async function placeCaret(page: Page): Promise<void> {
	await page
		.locator(".bn-editor .bn-inline-content", { hasText: LINE })
		.click();
}

/** The name the other window shows for this one. */
async function nameSeenBy(page: Page): Promise<string> {
	await expect(avatars(page)).toHaveCount(1, { timeout: JOIN_MS });
	return (await avatars(page).getAttribute("aria-label")) ?? "";
}

async function shot(page: Page, testInfo: TestInfo, name: string) {
	await testInfo.attach(name, {
		body: await page.screenshot(),
		contentType: "image/png",
	});
}

interface Scene {
	folder: string;
	shared: SeededNote;
	elsewhere: SeededNote;
	host: Page;
	guest: Page;
	/** A third window, in its own browser context, that comes back after going offline. */
	returning: BrowserContext;
	testInfo: TestInfo;
}

function seededNotes(testInfo: TestInfo) {
	const stamp = `${testInfo.project.name}-${Date.now()}`;
	const folder = `presence-${stamp}`;
	return {
		folder,
		shared: { path: `${folder}/shared.md`, title: `Shared ${stamp}` },
		elsewhere: { path: `${folder}/elsewhere.md`, title: `Elsewhere ${stamp}` },
	};
}

async function seed(
	request: APIRequestContext,
	{ folder, shared, elsewhere }: ReturnType<typeof seededNotes>,
): Promise<void> {
	await createNote(
		request,
		shared.path,
		`# ${shared.title}\n\n${LINE}\n\nSee [[${folder}/elsewhere]].\n`,
	);
	await createNote(request, elsewhere.path, `# ${elsewhere.title}\n\nBody.\n`);
}

/** Each sees the other's avatar, named after its browser and device, and listed on a tap. */
async function expectEachSeesTheOther({ host, guest, testInfo }: Scene) {
	const guestName = await nameSeenBy(host);
	const hostName = await nameSeenBy(guest);
	expect([guestName, hostName]).not.toContain("");
	// A phone has no hover: the names are a tap away.
	await host.getByTestId("note-presence").click();
	await expect(host.getByTestId("note-presence-list")).toContainText(guestName);
	await shot(host, testInfo, "presence-list");
	await host.keyboard.press("Escape");
	return { guestName, hostName };
}

/** A caret placed by one shows in the other with its name, in a phone-sized label. */
async function expectNamedCarets(
	{ host, guest, testInfo }: Scene,
	{ guestName, hostName }: { guestName: string; hostName: string },
) {
	await placeCaret(guest);
	await expect(remoteCursors(host)).toHaveCount(1, { timeout: JOIN_MS });
	await expect(remoteCursors(host)).toContainText(guestName);
	await placeCaret(host);
	await expect(remoteCursors(guest)).toContainText(hostName, {
		timeout: JOIN_MS,
	});
	await shot(host, testInfo, "presence-cursor");
	const label = await remoteCursors(host)
		.locator(".bn-collaboration-cursor__label")
		.boundingBox();
	expect(label?.width ?? 0).toBeLessThanOrEqual(170);
}

/** The guest follows a link to another note. */
/**
 * The guest follows a link to another note. Only leaving matters here: the other note's own
 * document opening is covered by the editing specs.
 */
async function expectSwitchClears({ host, guest, folder }: Scene) {
	await guest
		.locator(`.bn-editor .wikilink[data-target="${folder}/elsewhere"]`)
		.focus();
	await guest.keyboard.press("Enter");
	await expect(guest).toHaveURL(/elsewhere\.md/u);
	await expect(avatars(host)).toHaveCount(0, { timeout: LEAVE_MS });
	await expect(remoteCursors(host)).toHaveCount(0);
}

/** Another window goes offline and comes back online, then closes its tab. */
async function expectOfflineAndCloseClear({ host, returning, shared }: Scene) {
	const page = await returning.newPage();
	await openNote(page, shared);
	await expect(avatars(host)).toHaveCount(1, { timeout: JOIN_MS });
	await returning.setOffline(true);
	await expect(avatars(host)).toHaveCount(0, { timeout: LEAVE_MS });
	await returning.setOffline(false);
	await expect(avatars(host)).toHaveCount(1, { timeout: JOIN_MS });
	await page.close();
	await expect(avatars(host)).toHaveCount(0, { timeout: LEAVE_MS });
}

test("two windows on a note see each other, and a window that leaves is gone within 5 s", async ({
	browser,
	request,
}, testInfo) => {
	const notes = seededNotes(testInfo);
	await seed(request, notes);
	const hostContext = await remoteContext(browser, testInfo);
	const guestContext = await remoteContext(browser, testInfo);
	const returning = await remoteContext(browser, testInfo);
	try {
		const scene: Scene = {
			...notes,
			host: await hostContext.newPage(),
			guest: await guestContext.newPage(),
			returning,
			testInfo,
		};
		await openNote(scene.host, notes.shared);
		await openNote(scene.guest, notes.shared);

		const names = await expectEachSeesTheOther(scene);
		await expectNamedCarets(scene, names);
		await expectSwitchClears(scene);
		await expectOfflineAndCloseClear(scene);
	} finally {
		await hostContext.close();
		await guestContext.close();
		await returning.close();
		await deleteNote(request, notes.shared.path);
		await deleteNote(request, notes.elsewhere.path);
	}
});
