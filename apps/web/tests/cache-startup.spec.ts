import { type BrowserContext, expect, type Page, test } from "@playwright/test";

/**
 * Cache-first startup test (TOL-173): verifies that the web app renders from
 * IndexedDB cache instantly on reload, then revalidates in the background without
 * blocking screens or long main-thread tasks.
 */

async function measurePaintTime(page: Page): Promise<number> {
	return page.evaluate(() => {
		const paint = performance
			.getEntriesByType("paint")
			.find((e) => e.name === "first-contentful-paint");
		return paint ? paint.startTime : 0;
	});
}

/**
 * When the cached note list painted, recorded by the page itself (TOL-206): the shell marks
 * `memoria:note_list_painted` once its first rows are on screen, so the budget measures the
 * paint rather than when a polling locator happened to look.
 */
async function measureNoteListPaint(page: Page): Promise<number> {
	return page.evaluate(
		() =>
			new Promise<number>((resolve) => {
				const read = () => {
					const entry = performance.getEntriesByName(
						"memoria:note_list_painted",
					)[0];
					if (entry) resolve(entry.startTime);
					else setTimeout(read, 50);
				};
				read();
			}),
	);
}

async function checkForLongTasks(page: Page): Promise<number> {
	return page.evaluate(() => {
		const observer = new PerformanceObserver(() => {});
		observer.observe({ entryTypes: ["longtask"] });
		const longTasks = performance.getEntriesByType(
			"longtask",
		) as PerformanceEntry[];
		return Math.max(...longTasks.map((t) => t.duration), 0);
	});
}

const TEST_TOKEN = "e2e-token-not-a-secret-0123456789";

async function configureRemoteVault(page: Page): Promise<void> {
	await page.addInitScript((token) => {
		window.MEMORIA_REMOTE_URL = window.location.origin;
		window.MEMORIA_REMOTE_TOKEN = token;
	}, TEST_TOKEN);
}

async function waitForNoteList(page: Page): Promise<void> {
	await expect(
		page
			.getByTestId("note-list-container")
			.getByText("Welcome", { exact: true }),
	).toBeVisible({ timeout: 10_000 });
}

async function throttleOnChromium(
	context: BrowserContext,
	page: Page,
): Promise<void> {
	if (context.browser()?.browserType().name() !== "chromium") return;
	const client = await context.newCDPSession(page);
	await client.send("Network.emulateNetworkConditions", {
		offline: false,
		downloadThroughput: (4 * 1024 * 1024) / 8,
		uploadThroughput: (3 * 1024 * 1024) / 8,
		latency: 20,
	});
}

test("cache-first startup paints under 1s on 4G, no blocking screens", async ({
	context,
	page,
}) => {
	await configureRemoteVault(page);
	// First visit: populate the cache
	await page.goto("/", { waitUntil: "networkidle" });
	await waitForNoteList(page);

	// Verify cache was written
	const cacheWritten = await page.evaluate(async () => {
		const db = await new Promise<IDBDatabase | null>((resolve) => {
			const req = indexedDB.open("memoria-entries", 1);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => resolve(null);
		});
		if (!db) return false;

		const hasCached = await new Promise<boolean>((resolve) => {
			const tx = db.transaction("entries", "readonly");
			const store = tx.objectStore("entries");
			const req = store.get("snapshot");
			req.onsuccess = () => resolve(req.result !== undefined);
			req.onerror = () => resolve(false);
		});
		db.close();
		return hasCached;
	});

	expect(cacheWritten).toBe(true);

	// Second visit with 4G throttling: measure cached paint
	await throttleOnChromium(context, page);

	await page.reload({ waitUntil: "domcontentloaded" });

	// Check that notes render from cache
	await waitForNoteList(page);
	const listPaintTime = await measureNoteListPaint(page);
	const paintTime = await measurePaintTime(page);

	// The cached list, and the first paint, are under 1 second
	expect(listPaintTime).toBeLessThan(1000);
	expect(paintTime).toBeLessThan(1000);

	// No blocking or reloading screens should appear
	await expect(page.getByTestId("vault-loading-skeleton")).not.toBeVisible();
	await expect(page.getByTestId("status-vault-reloading")).not.toBeVisible();

	// Wait for background revalidation to complete
	await page.waitForTimeout(2000);

	// Check for long tasks during revalidation
	const maxTaskDuration = await checkForLongTasks(page);
	expect(maxTaskDuration).toBeLessThan(200);
});

test("first-ever load fetches remote notes and stores a cache snapshot", async ({
	context,
	page,
}) => {
	await configureRemoteVault(page);
	// Clear any existing cache
	await page.goto("/");
	await page.evaluate(() => {
		return new Promise<void>((resolve) => {
			const req = indexedDB.deleteDatabase("memoria-entries");
			req.onsuccess = () => resolve();
			req.onerror = () => resolve();
		});
	});

	// Close and reopen to ensure clean state
	await page.close();
	const newPage = await context.newPage();
	await configureRemoteVault(newPage);

	await throttleOnChromium(context, newPage);

	await newPage.goto("/", { waitUntil: "domcontentloaded" });
	await waitForNoteList(newPage);
	await expect
		.poll(async () =>
			newPage.evaluate(async () => {
				const db = await new Promise<IDBDatabase | null>((resolve) => {
					const request = indexedDB.open("memoria-entries", 1);
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => resolve(null);
				});
				if (!db) return false;
				const hasSnapshot = await new Promise<boolean>((resolve) => {
					const request = db
						.transaction("entries", "readonly")
						.objectStore("entries")
						.get("snapshot");
					request.onsuccess = () => resolve(request.result !== undefined);
					request.onerror = () => resolve(false);
				});
				db.close();
				return hasSnapshot;
			}),
		)
		.toBe(true);

	await newPage.close();
});

test("graceful fallback when IndexedDB unavailable", async ({ page }) => {
	await configureRemoteVault(page);
	// Simulate IndexedDB being unavailable
	await page.addInitScript(() => {
		Object.defineProperty(window, "indexedDB", {
			value: undefined,
			configurable: true,
		});
	});

	await page.goto("/");

	// App should still load, just without caching
	await waitForNoteList(page);
	await expect(
		page
			.getByTestId("note-list-container")
			.getByText("Welcome", { exact: true }),
	).toBeVisible();
});
