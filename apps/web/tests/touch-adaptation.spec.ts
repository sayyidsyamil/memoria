import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";

/**
 * TOL-24: where a finger drives the web app, a long press opens the context menus a right click
 * opens with a mouse, key targets measure at least 44 × 44 px, the empty editor offers buttons
 * instead of keyboard chords, and a tap focuses the editor. A mouse keeps the desktop behaviour.
 */

const PHONE_PROJECTS = ["iphone-15"];
const TABLET_PROJECTS = ["ipad", "ipad-landscape"];
const DESKTOP_PROJECTS = ["chromium", "webkit"];
const NOTE_TITLE = "Build Laputa App";
const TYPE_NAME = "Projects";
const MIN_TARGET_PX = 44;
/** Longer than the 500 ms the app waits for: what a person holding a finger down sends. */
const HOLD_MS = 700;

test.describe.configure({ retries: 0 });

function isPhone(testInfo: TestInfo): boolean {
	return PHONE_PROJECTS.includes(testInfo.project.name);
}

function isTouch(testInfo: TestInfo): boolean {
	return [...PHONE_PROJECTS, ...TABLET_PROJECTS].includes(testInfo.project.name);
}

function noteList(page: Page): Locator {
	return page.getByTestId("note-list-container");
}

/** The note list pane with its header; the header sits outside `note-list-container`. */
function noteListPane(page: Page): Locator {
	return page.locator(".app__note-list");
}

function noteItem(page: Page): Locator {
	return noteList(page).getByText(NOTE_TITLE, { exact: true });
}

async function openApp(page: Page): Promise<void> {
	await page.goto("/", { waitUntil: "domcontentloaded" });
	await expect(noteItem(page)).toBeVisible({ timeout: 20_000 });
}

async function openNote(page: Page): Promise<void> {
	await noteItem(page).tap();
	await expect(page.locator(".bn-editor").first()).toContainText("bold text", { timeout: 15_000 });
}

/** A finger held still on `target`: touch pointer events, as iOS and Android send them. */
async function longPress(page: Page, target: Locator): Promise<void> {
	const box = await target.boundingBox();
	if (!box) throw new Error("long-press target is not visible");
	const point = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
	const init = { ...point, pointerType: "touch", pointerId: 7, isPrimary: true, bubbles: true, cancelable: true };
	await target.dispatchEvent("pointerdown", init);
	await page.waitForTimeout(HOLD_MS);
	await target.dispatchEvent("pointerup", init);
	await target.dispatchEvent("click", { ...point, bubbles: true, cancelable: true });
}

async function expectTouchTarget(target: Locator, name: string): Promise<void> {
	const box = await target.boundingBox();
	expect(box, name).not.toBeNull();
	expect(Math.round(box?.width ?? 0), `${name} width`).toBeGreaterThanOrEqual(MIN_TARGET_PX);
	expect(Math.round(box?.height ?? 0), `${name} height`).toBeGreaterThanOrEqual(MIN_TARGET_PX);
}

/** Neighbouring targets must not cover each other, or a tap could hit the wrong one. */
async function expectNoOverlap(targets: Locator): Promise<void> {
	const boxes = (await Promise.all((await targets.all()).map((target) => target.boundingBox())))
		.filter((box) => box !== null);
	for (const [index, a] of boxes.entries()) {
		for (const b of boxes.slice(index + 1)) {
			const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
			const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
			expect(overlapX > 1 && overlapY > 1, "targets overlap").toBe(false);
		}
	}
}

async function expectMenuTargets(menu: Locator, name: string): Promise<void> {
	const items = menu.locator('[data-slot="button"]');
	expect(await items.count()).toBeGreaterThan(0);
	for (const item of await items.all()) {
		const box = await item.boundingBox();
		expect(Math.round(box?.height ?? 0), `${name} item height`).toBeGreaterThanOrEqual(MIN_TARGET_PX);
	}
}

async function expandSidebar(page: Page): Promise<Locator> {
	await page.getByRole("button", { name: "Expand sidebar" }).tap();
	const sidebar = page.locator(".app__sidebar");
	await expect(sidebar).toBeVisible();
	return sidebar;
}

function noteParam(page: Page): string | null {
	return new URL(page.url()).searchParams.get("note");
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
	await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
}

test("touch: a long press on a note opens its menu, without opening the note", async ({ page }, testInfo) => {
	test.skip(!isTouch(testInfo), "touch layouts only");
	await openApp(page);
	await longPress(page, noteItem(page));

	const menu = page.getByTestId("note-list-context-menu");
	await expect(menu).toBeVisible();
	await expectMenuTargets(menu, "note menu");
	expect(noteParam(page)).toBeNull();
	if (isPhone(testInfo)) await expect(page.locator(".app__editor")).toBeHidden();
	await shot(page, testInfo, "touch-note-long-press-menu");

	// A tap beside the menu closes it, as with a mouse click.
	await noteListPane(page).getByRole("button", { name: "Search notes" }).tap();
	await expect(menu).toHaveCount(0);
});

test("touch: a long press on a sidebar type opens its menu", async ({ page }, testInfo) => {
	test.skip(!TABLET_PROJECTS.includes(testInfo.project.name), "the phone has no sidebar yet");
	await openApp(page);
	const sidebar = await expandSidebar(page);
	await longPress(page, sidebar.getByText(TYPE_NAME, { exact: true }));

	const menu = page.getByTestId("sidebar-type-context-menu");
	await expect(menu).toBeVisible();
	await expectMenuTargets(menu, "type menu");
	await shot(page, testInfo, "touch-sidebar-long-press-menu");
});

test("touch: key targets measure at least 44 × 44 px", async ({ page }, testInfo) => {
	test.skip(!isTouch(testInfo), "touch layouts only");
	await openApp(page);
	await expect(page.locator("html")).toHaveAttribute("data-touch-input", "");
	for (const name of ["Search notes", "Create new note"]) {
		await expectTouchTarget(noteListPane(page).getByRole("button", { name }), name);
	}
	await expectTouchTarget(noteList(page).locator(".cursor-pointer").filter({ hasText: NOTE_TITLE }).first(), "note row");

	// The list header: every control above the notes.
	const headerControls = noteListPane(page).locator('button:not([data-testid="note-list-container"] *)');
	await expectNoOverlap(headerControls);
	for (const control of await headerControls.all()) await expectTouchTarget(control, "note list header control");

	if (isPhone(testInfo)) {
		await openNote(page);
		await expectTouchTarget(page.getByTestId("phone-back-to-notes"), "back to notes");
	} else {
		await expectTouchTarget(page.getByRole("button", { name: "Expand sidebar" }), "Expand sidebar");
		const sidebar = await expandSidebar(page);
		await expectTouchTarget(sidebar.getByRole("button", { name: "Collapse sidebar" }), "Collapse sidebar");
		const typeRow = sidebar.locator('[role="button"]').filter({ hasText: TYPE_NAME }).first();
		const box = await typeRow.boundingBox();
		expect(Math.round(box?.height ?? 0), "type row height").toBeGreaterThanOrEqual(MIN_TARGET_PX);
	}
	await shot(page, testInfo, "touch-targets");
});

test("touch: the empty editor is touch-first", async ({ page }, testInfo) => {
	test.skip(!TABLET_PROJECTS.includes(testInfo.project.name), "the phone shows the list, not an empty editor");
	await openApp(page);
	const emptyState = page.getByTestId("touch-empty-state");
	await expect(emptyState).toContainText("Tap a note to start editing");
	await expect(page.getByText("Select a note to start editing")).toHaveCount(0);
	await expectTouchTarget(emptyState.getByRole("button", { name: "Search notes" }), "empty-state search");
	await expectTouchTarget(emptyState.getByRole("button", { name: "Create new note" }), "empty-state new note");
	await shot(page, testInfo, "touch-empty-state");

	await emptyState.getByRole("button", { name: "Search notes" }).tap();
	await expect(page.getByTestId("quick-open-palette")).toBeVisible();
});

test("touch: a tap focuses the editor at once", async ({ page }, testInfo) => {
	test.skip(!isTouch(testInfo), "touch layouts only");
	await openApp(page);
	await openNote(page);
	await page.locator(".bn-editor .bn-inline-content").first().tap();
	await expect.poll(() => page.evaluate(() => document.activeElement?.closest(".bn-editor") !== null)).toBe(true);
});

test("mouse: right click opens the menu and the desktop sizes stay", async ({ page }, testInfo) => {
	test.skip(!DESKTOP_PROJECTS.includes(testInfo.project.name), "mouse layouts only");
	await openApp(page);
	await expect(page.locator("html")).not.toHaveAttribute("data-touch-input", "");
	const search = noteListPane(page).getByRole("button", { name: "Search notes" });
	expect((await search.boundingBox())?.height ?? 0).toBeLessThan(MIN_TARGET_PX);
	await expect(page.getByTestId("touch-empty-state")).toHaveCount(0);

	await noteItem(page).click({ button: "right" });
	const menu = page.getByTestId("note-list-context-menu");
	await expect(menu).toBeVisible();
	const item = menu.locator('[data-slot="button"]').first();
	expect((await item.boundingBox())?.height ?? 0).toBeLessThan(MIN_TARGET_PX);
	await shot(page, testInfo, "mouse-right-click-menu");
});
