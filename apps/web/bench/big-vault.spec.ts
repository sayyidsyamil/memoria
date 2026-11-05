import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import {
	type BigVaultMeasurements,
	evaluateBudgets,
	formatBenchReport,
} from "../bigVaultBudgets";
import { BENCH_NOTE_COUNT, BENCH_TOKEN } from "../playwright.bench.config";

/**
 * Big-vault performance bench (TOL-225): one browser session against a 6,000-note vault.
 * It opens the vault cold (no cache), reloads it warm (cache first, background reload),
 * opens a note, types into it and searches, then checks every number against its budget.
 */

const REPORT_DIR = join(process.cwd(), "test-results", "web-bench");
/** How long the last warm open is watched for long tasks: the background reload runs in it. */
const SETTLE_MS = 5_000;
const TYPED_TEXT = " the quick brown fox jumps over the lazy dog";
const SEARCH_QUERY = "4321";
const SEARCH_TITLE = "Filler 4321";
const WARM_OPENS = 3;

interface LongTask {
	start: number;
	duration: number;
}

declare global {
	interface Window {
		__memoriaBench: {
			longTasks: LongTask[];
			keyLatencies: number[];
			recordKeys: boolean;
		};
	}
}

/** Collects long tasks from navigation start, and keystroke-to-next-frame latencies. */
function installProbes(): void {
	const bench = { longTasks: [], keyLatencies: [], recordKeys: false };
	window.__memoriaBench = bench;
	new PerformanceObserver((list) => {
		for (const entry of list.getEntries())
			bench.longTasks.push({
				start: entry.startTime,
				duration: entry.duration,
			});
	}).observe({ type: "longtask", buffered: true });
	window.addEventListener(
		"keydown",
		(event) => {
			if (!bench.recordKeys) return;
			const start = event.timeStamp;
			requestAnimationFrame(() => {
				const channel = new MessageChannel();
				channel.port1.onmessage = () =>
					bench.keyLatencies.push(performance.now() - start);
				channel.port2.postMessage(null);
			});
		},
		true,
	);
}

async function preparePage(page: Page): Promise<void> {
	await page.addInitScript((token) => {
		window.MEMORIA_REMOTE_URL = window.location.origin;
		window.MEMORIA_REMOTE_TOKEN = token;
		window.localStorage.setItem(
			"memoria:claude-code-onboarding-dismissed",
			"1",
		);
	}, BENCH_TOKEN);
	await page.addInitScript(installProbes);
}

/** When the note list first had rows on screen, from the shell's own mark (TOL-206). */
async function noteListPaintedAt(page: Page): Promise<number> {
	await page.waitForFunction(
		() => performance.getEntriesByName("memoria:note_list_painted").length > 0,
		null,
		{ timeout: 60_000 },
	);
	return page.evaluate(
		() =>
			performance.getEntriesByName("memoria:note_list_painted")[0].startTime,
	);
}

/** Waits until the cache snapshot holds every note (and the attachment), so the reload is warm. */
async function waitForFullCacheSnapshot(page: Page): Promise<void> {
	await expect
		.poll(
			() =>
				page.evaluate(async () => {
					const db = await new Promise<IDBDatabase | null>((resolve) => {
						const request = indexedDB.open("memoria-entries", 1);
						request.onsuccess = () => resolve(request.result);
						request.onerror = () => resolve(null);
					});
					if (!db) return 0;
					const count = await new Promise<number>((resolve) => {
						const request = db
							.transaction("entries", "readonly")
							.objectStore("entries")
							.get("snapshot");
						request.onsuccess = () =>
							resolve(request.result?.entries?.length ?? 0);
						request.onerror = () => resolve(0);
					});
					db.close();
					return count;
				}),
			{ timeout: 60_000 },
		)
		.toBeGreaterThanOrEqual(BENCH_NOTE_COUNT);
}

/** The longest main-thread task and the total blocking time (time over 50 ms) so far. */
async function longTaskSummary(
	page: Page,
	since = 0,
): Promise<{ maxMs: number; blockingMs: number }> {
	const tasks = await page.evaluate(
		(from) => window.__memoriaBench.longTasks.filter((t) => t.start >= from),
		since,
	);
	return {
		maxMs: Math.max(0, ...tasks.map((task) => task.duration)),
		blockingMs: tasks.reduce((sum, task) => sum + task.duration - 50, 0),
	};
}

async function usedHeapMb(
	context: BrowserContext,
	page: Page,
): Promise<number> {
	const client = await context.newCDPSession(page);
	await client.send("HeapProfiler.collectGarbage");
	const { usedSize } = await client.send("Runtime.getHeapUsage");
	await client.detach();
	return usedSize / (1024 * 1024);
}

async function pageNow(page: Page): Promise<number> {
	return page.evaluate(() => performance.now());
}

/** From the click on a note row to its body on screen in the editor. */
async function openNoteMs(page: Page, title: string): Promise<number> {
	const row = page
		.getByTestId("note-list-container")
		.getByText(title, { exact: true })
		.first();
	await expect(row).toBeVisible({ timeout: 30_000 });
	const started = Date.now();
	await row.click();
	await expect(
		page.locator(".bn-editor").getByText("so listing and search run").first(),
	).toBeVisible({ timeout: 30_000 });
	return Date.now() - started;
}

function percentile(values: number[], fraction: number): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[
		Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
	];
}

async function typingLatency(page: Page) {
	await page.locator(".bn-editor .bn-inline-content").last().click();
	await page.keyboard.press("End");
	const since = await pageNow(page);
	await page.evaluate(() => {
		window.__memoriaBench.recordKeys = true;
	});
	await page.keyboard.type(TYPED_TEXT, { delay: 40 });
	await expect(page.locator(".bn-editor")).toContainText(TYPED_TEXT.trim());
	await page.waitForTimeout(500);
	const latencies = await page.evaluate(() => {
		window.__memoriaBench.recordKeys = false;
		return window.__memoriaBench.keyLatencies;
	});
	expect(latencies.length).toBe(TYPED_TEXT.length);
	return {
		p50: percentile(latencies, 0.5),
		p95: percentile(latencies, 0.95),
		longTasks: await longTaskSummary(page, since),
	};
}

/** From the query landing in the search box to its matching result on screen. */
async function searchMs(page: Page): Promise<number> {
	await page.locator("body").click();
	await page.keyboard.press("Control+Shift+F");
	const input = page.locator('input[placeholder="Search in all notes..."]');
	await expect(input).toBeVisible({ timeout: 10_000 });
	const started = Date.now();
	await input.fill(SEARCH_QUERY);
	await expect(
		page
			.getByRole("listbox", { name: "Search results" })
			.getByText(SEARCH_TITLE, { exact: true }),
	).toBeVisible({ timeout: 30_000 });
	return Date.now() - started;
}

async function writeReport(
	measurements: BigVaultMeasurements,
	report: string,
): Promise<void> {
	await mkdir(REPORT_DIR, { recursive: true });
	const json = { noteCount: BENCH_NOTE_COUNT, measurements };
	await writeFile(
		join(REPORT_DIR, "big-vault.json"),
		`${JSON.stringify(json, null, 2)}\n`,
	);
	await writeFile(join(REPORT_DIR, "big-vault.md"), `${report}\n`);
}

type OpenMeasurements = Pick<
	BigVaultMeasurements,
	| "coldOpenMs"
	| "coldMaxLongTaskMs"
	| "warmOpenMs"
	| "warmMaxLongTaskMs"
	| "warmBlockingMs"
	| "heapMb"
>;

/** Cold open with an empty cache, then warm opens from the cache it wrote. */
async function measureOpens(
	context: BrowserContext,
	page: Page,
): Promise<OpenMeasurements> {
	await page.goto("/");
	const coldOpenMs = await noteListPaintedAt(page);
	await waitForFullCacheSnapshot(page);
	const cold = await longTaskSummary(page);

	const warmOpens: number[] = [];
	for (let open = 0; open < WARM_OPENS; open++) {
		await page.reload();
		warmOpens.push(await noteListPaintedAt(page));
	}
	await page.waitForTimeout(SETTLE_MS);
	const warm = await longTaskSummary(page);
	return {
		coldOpenMs,
		coldMaxLongTaskMs: cold.maxMs,
		warmOpenMs: percentile(warmOpens, 0.5),
		warmMaxLongTaskMs: warm.maxMs,
		warmBlockingMs: warm.blockingMs,
		heapMb: await usedHeapMb(context, page),
	};
}

async function measureInteractions(
	page: Page,
): Promise<Omit<BigVaultMeasurements, keyof OpenMeasurements>> {
	const noteOpenMs = await openNoteMs(page, "Filler 1");
	const typing = await typingLatency(page);
	return {
		noteOpenMs,
		typingP50Ms: typing.p50,
		typingP95Ms: typing.p95,
		typingMaxLongTaskMs: typing.longTasks.maxMs,
		searchMs: await searchMs(page),
	};
}

test("a 6,000-note vault opens, searches and types within budget", async ({
	context,
	page,
}) => {
	await preparePage(page);
	const measurements: BigVaultMeasurements = {
		...(await measureOpens(context, page)),
		...(await measureInteractions(page)),
	};
	const results = evaluateBudgets(measurements);
	const report = formatBenchReport(results, BENCH_NOTE_COUNT);
	await writeReport(measurements, report);
	process.stdout.write(`\n${report}\n\n`);
	const overBudget = results.filter((result) => !result.withinBudget);
	expect(overBudget.map((result) => result.label)).toEqual([]);
});
