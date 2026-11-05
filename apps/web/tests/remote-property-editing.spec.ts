import { execFileSync } from "node:child_process";
import {
	type APIRequestContext,
	expect,
	type Page,
	test,
} from "@playwright/test";
import { updateFrontmatterContent } from "../../../src/lib/frontmatterText/ops";
import { COLLAB_TOKEN, REMOTE_GIT_DIR } from "../playwright.config";

/**
 * TOL-203: a property edited in the web properties panel is a transaction on the note's
 * live document. The server writes it to the file with exactly the bytes the desktop writer
 * would, and the commit it pushes changes one hunk.
 */

// remote-note-editing.spec.ts types into this note's body; changing its type does not touch that.
const NOTE_PATH = "journal/2026-10-10.md";
const NOTE_TITLE = "10 October 2026";
const BODY_LINE = "Sketched the sync protocol.";
const AUTH = { authorization: `Bearer ${COLLAB_TOKEN}` };
// The properties panel is laid out differently on phones and tablets.
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

function remoteGit(args: string[]): string {
	return execFileSync("git", ["--git-dir", REMOTE_GIT_DIR, ...args], {
		encoding: "utf8",
	});
}

function remoteContent(): string {
	return remoteGit(["show", `main:${NOTE_PATH}`]);
}

/** The hunks of the note's diff between a commit and the remote's main. */
function remoteHunks(since: string): string[] {
	const diff = remoteGit(["diff", "-U0", since, "main", "--", NOTE_PATH]);
	return diff.split("\n").filter((line) => line.startsWith("@@"));
}

async function openNote(page: Page): Promise<void> {
	await page.goto("/", { waitUntil: "load" });
	const noteList = page.getByTestId("note-list-container");
	await expect(noteList.getByText(NOTE_TITLE, { exact: true })).toBeVisible({
		timeout: 10_000,
	});
	await noteList.getByText(NOTE_TITLE, { exact: true }).click();
	await expect(
		page.locator(".bn-editor .bn-inline-content", { hasText: BODY_LINE }).first(),
	).toBeVisible({ timeout: 10_000 });
}

async function openPropertiesPanel(page: Page): Promise<void> {
	const openPanel = page.getByRole("button", {
		name: "Open the properties panel",
	});
	if (await openPanel.count()) await openPanel.first().click();
	await expect(page.getByTestId("add-property-row")).toBeVisible();
}

async function addNumberProperty(
	page: Page,
	key: string,
	value: number,
): Promise<void> {
	await page.getByTestId("add-property-row").focus();
	await page.keyboard.press("Enter");
	await expect(page.getByTestId("add-property-form")).toBeVisible();
	await page.keyboard.type(key);
	await page.getByTestId("add-property-type-trigger").click();
	const numberOption = page.getByRole("option", { name: "Number", exact: true });
	await numberOption.click();
	// WebKit can keep the select open a moment: typing must not go to it.
	await expect(numberOption).toBeHidden();
	await page.getByTestId("add-property-number-input").fill(String(value));
	await page.getByTestId("add-property-confirm").click();
	await expect(page.getByTestId("add-property-form")).toBeHidden();
}

test("a property edited on the web changes one hunk, with the desktop's bytes", async ({
	page,
	request,
}, testInfo) => {
	test.skip(
		!DESKTOP_PROJECTS.includes(testInfo.project.name),
		"desktop layouts only",
	);
	await configureRemoteVault(page);
	await openNote(page);
	await openPropertiesPanel(page);

	// One server serves every project of the run: each adds its own property.
	const key = `Estimate ${testInfo.project.name}`;
	const value = 100 + (Date.now() % 900);
	const before = await serverContent(request);
	await expect.poll(remoteContent, { timeout: 10_000 }).toBe(before);
	const since = remoteGit(["rev-parse", "main"]).trim();
	const expected = updateFrontmatterContent(before, key, value);
	expect(expected).toContain(`"${key}": ${value}\n`);

	const fileWrites: string[] = [];
	page.on("request", (sent) => {
		if (sent.method() === "PUT" && sent.url().includes("/v1/files/"))
			fileWrites.push(sent.url());
	});
	await addNumberProperty(page, key, value);

	await expect
		.poll(() => serverContent(request), { timeout: 20_000 })
		.toBe(expected);
	await expect.poll(remoteContent, { timeout: 20_000 }).toBe(expected);
	expect(remoteHunks(since)).toHaveLength(1);
	expect(fileWrites, "the edit went through the live document").toEqual([]);
	expect(remoteGit(["diff", "-U0", since, "main", "--", NOTE_PATH])).toContain(
		`\n+"${key}": ${value}\n`,
	);

	// The edit lives in the note's document: a reload shows it, and the body is intact.
	await page.reload({ waitUntil: "load" });
	await openNote(page);
	await openPropertiesPanel(page);
	await expect(page.getByText(key, { exact: true })).toBeVisible();
	expect(await serverContent(request)).toBe(expected);
});
