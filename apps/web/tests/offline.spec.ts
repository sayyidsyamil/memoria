import {
	type APIRequestContext,
	type BrowserContext,
	expect,
	type Page,
	test,
} from "@playwright/test";
import { COLLAB_TOKEN } from "../playwright.config";
import { OFFLINE_ORIGIN, OfflineOrigin } from "./offlineOrigin";

/**
 * TOL-198: a note opened in an earlier session opens with the network gone, from the
 * service worker's cache, read-only and marked offline. A note never opened fails, which
 * proves the worker's own fetches are cut too. An edit attempted offline is not kept
 * anywhere to send later, and one account's cached notes never reach another.
 */

const CACHED = { path: "projects/heron.md", title: "Heron", body: "Owned by" };
const OFFLINE_EDIT = "typed-while-offline";

test.describe.configure({ mode: "serial", retries: 0 });
test.use({ baseURL: OFFLINE_ORIGIN });

const origin = new OfflineOrigin();

test.beforeEach(async () => {
	await origin.start();
});

test.afterEach(async () => {
	await origin.stop().catch(() => {});
});

test.afterAll(async () => {
	await origin.dispose();
});

/**
 * The remote vault, and what the device reports about its connection: `navigator.onLine`
 * and the online/offline events, as a phone in airplane mode would.
 */
async function configurePage(page: Page, online: boolean): Promise<void> {
	await page.addInitScript(
		({ token, startOnline }) => {
			window.MEMORIA_REMOTE_URL = window.location.origin;
			window.MEMORIA_REMOTE_TOKEN = token;
			window.localStorage.setItem("memoria:claude-code-onboarding-dismissed", "1");
			let onLine = startOnline;
			Object.defineProperty(Navigator.prototype, "onLine", {
				configurable: true,
				get: () => onLine,
			});
			Reflect.set(window, "__setDeviceOnline", (next: boolean) => {
				onLine = next;
				window.dispatchEvent(new Event(next ? "online" : "offline"));
			});
		},
		{ token: COLLAB_TOKEN, startOnline: online },
	);
}

async function setDeviceOnline(page: Page, online: boolean): Promise<void> {
	await page.evaluate((next) => {
		(Reflect.get(window, "__setDeviceOnline") as (value: boolean) => void)(next);
	}, online);
}

function noteList(page: Page) {
	return page.getByTestId("note-list-container");
}

function editor(page: Page) {
	return page.locator(".bn-editor");
}

async function openNote(page: Page, title: string): Promise<void> {
	await noteList(page).getByText(title, { exact: true }).click();
}

/** Status of an authorized note request made by the page, through the service worker. */
async function pageFetchStatus(
	page: Page,
	path: string,
	token = COLLAB_TOKEN,
): Promise<number | "failed"> {
	return page.evaluate(
		async ({ url, bearer }) => {
			try {
				const response = await fetch(url, {
					headers: { authorization: `Bearer ${bearer}` },
				});
				return response.status;
			} catch {
				return "failed" as const;
			}
		},
		{ url: `/v1/files/${path}`, bearer: token },
	);
}

async function isCached(page: Page, path: string): Promise<boolean> {
	return page.evaluate(
		async (url) => !!(await caches.match(new URL(url, location.origin).href)),
		`/v1/files/${path}`,
	);
}

const AUTHORIZATION = { authorization: `Bearer ${COLLAB_TOKEN}` };

async function serverContent(request: APIRequestContext, path: string) {
	const response = await request.get(`/v1/files/${path}`, {
		headers: AUTHORIZATION,
	});
	expect(response.status()).toBe(200);
	return response.text();
}

/**
 * A note that exists on the server but that no session ever loaded: the app may prefetch
 * any note of the list, so the uncached one is written after the first session.
 */
async function createUnopenedNote(
	request: APIRequestContext,
	project: string,
): Promise<string> {
	const path = `offline-probe/${project}-${Date.now()}.md`;
	const response = await request.put(`/v1/files/${path}`, {
		headers: { ...AUTHORIZATION, "if-none-match": "*" },
		data: "# Never opened\n",
	});
	expect(response.ok()).toBe(true);
	return path;
}

async function deleteNote(request: APIRequestContext, path: string) {
	const current = await request.get(`/v1/files/${path}`, {
		headers: AUTHORIZATION,
	});
	const etag = current.headers().etag;
	if (!current.ok() || !etag) return;
	await request.delete(`/v1/files/${path}`, {
		headers: { ...AUTHORIZATION, "if-match": etag },
	});
}

/** First session, online: the worker takes over, and one note is opened. */
async function visitOnline(context: BrowserContext): Promise<void> {
	const page = await context.newPage();
	await configurePage(page, true);
	await page.goto("/", { waitUntil: "networkidle" });
	await expect(noteList(page).getByText(CACHED.title, { exact: true })).toBeVisible({
		timeout: 10_000,
	});
	await expect
		.poll(() => page.evaluate(() => !!navigator.serviceWorker?.controller), {
			timeout: 15_000,
		})
		.toBe(true);
	await openNote(page, CACHED.title);
	await expect(editor(page)).toContainText(CACHED.body, { timeout: 10_000 });
	await expect.poll(() => isCached(page, CACHED.path), { timeout: 10_000 }).toBe(true);
	await page.close();
}

/** Next session, with the network gone: the shell and the list come from the device. */
async function startOffline(context: BrowserContext): Promise<Page> {
	await origin.stop();
	const page = await context.newPage();
	await configurePage(page, false);
	await page.goto("/");
	await expect(noteList(page).getByText(CACHED.title, { exact: true })).toBeVisible({
		timeout: 10_000,
	});
	return page;
}

test("opens the last vault read-only with the network gone", async ({
	context,
	request,
}, testInfo) => {
	await visitOnline(context);
	const unopened = await createUnopenedNote(request, testInfo.project.name);
	const page = await startOffline(context);

	const syncPill = page.getByTestId("status-sync-pill");
	await expect(syncPill).toHaveAttribute("data-state", "offline");
	await expect(syncPill).toHaveAttribute("data-read-only", "true");
	await expect(syncPill).toHaveText("Offline · read-only");
	await expect(page.getByTestId("vault-loading-skeleton")).toHaveCount(0);

	// The note opened in the earlier session reads from the cache, and cannot change.
	await openNote(page, CACHED.title);
	await expect(editor(page)).toContainText(CACHED.body, { timeout: 10_000 });
	await expect(editor(page)).toHaveAttribute("contenteditable", "false");
	await editor(page).getByText(CACHED.body).click();
	await page.keyboard.type(OFFLINE_EDIT);
	await expect(editor(page)).not.toContainText(OFFLINE_EDIT);

	// A note never opened is not there: the worker cannot reach the network either.
	expect(await pageFetchStatus(page, CACHED.path)).toBe(200);
	expect(await pageFetchStatus(page, unopened)).toBe("failed");

	// Back online, the same request reaches the server, and nothing typed offline did.
	await origin.start();
	await setDeviceOnline(page, true);
	await expect(syncPill).not.toHaveAttribute("data-state", "offline");
	await expect(syncPill).not.toHaveAttribute("data-read-only");
	expect(await pageFetchStatus(page, unopened)).toBe(200);
	await page.waitForTimeout(2_000);
	expect(await serverContent(request, CACHED.path)).not.toContain(OFFLINE_EDIT);
	await deleteNote(request, unopened);
	await page.close();
});

test("another account never gets this account's cached notes", async ({
	context,
}) => {
	await visitOnline(context);
	const page = await startOffline(context);

	expect(await pageFetchStatus(page, CACHED.path)).toBe(200);
	expect(await pageFetchStatus(page, CACHED.path, "another-account-token")).toBe(
		"failed",
	);
	await page.close();
});
