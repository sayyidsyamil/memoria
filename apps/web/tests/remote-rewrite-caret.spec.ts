import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type APIRequestContext,
	expect,
	type Page,
	test,
} from "@playwright/test";
import { COLLAB_TOKEN, REMOTE_GIT_DIR } from "../playwright.config";

/**
 * TOL-236: the server takes in a desktop rewrite of the paragraph someone is typing in on the
 * web, before any of their keystrokes reached it. The caret stays in that paragraph and the
 * typing goes on there: nothing jumps to the next paragraph, nothing is lost or doubled.
 */

const AUTH = { authorization: `Bearer ${COLLAB_TOKEN}` };
const SECOND = "Second paragraph.";
const REWRITTEN = "Second paragraph, rewritten on the desktop.";

test.describe.configure({ retries: 0 });

interface RewriteNote {
	id: string;
	path: string;
	typed: string;
}

function noteFor(projectName: string): RewriteNote {
	const id = `tol236-${projectName}-${Date.now()}`;
	return { id, path: `rewrites/${id}.md`, typed: ` Typed on the web ${id}.` };
}

function markdown({ id }: RewriteNote, second: string): string {
	return `# Note ${id}\n\nFirst paragraph.\n\n${second}\n\nThird paragraph.\n`;
}

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function remoteHas(path: string): boolean {
	const tree = git(tmpdir(), [
		"--git-dir",
		REMOTE_GIT_DIR,
		"ls-tree",
		"-r",
		"--name-only",
		"main",
	]);
	return tree.split("\n").includes(path);
}

/** Pushes the desktop's rewrite of the second paragraph from a fresh clone of the vault. */
function pushDesktopRewrite(note: RewriteNote): void {
	const clone = mkdtempSync(join(tmpdir(), "memoria-desktop-"));
	try {
		git(tmpdir(), ["clone", "-q", REMOTE_GIT_DIR, clone]);
		git(clone, ["config", "user.email", "desktop@example.com"]);
		git(clone, ["config", "user.name", "Desktop"]);
		const file = join(clone, note.path);
		writeFileSync(file, readFileSync(file, "utf8").replace(SECOND, REWRITTEN));
		git(clone, ["commit", "-qam", `Desktop edit of ${note.path}`]);
		git(clone, ["push", "-q", "origin", "HEAD:main"]);
	} finally {
		rmSync(clone, { recursive: true, force: true });
	}
}

async function serverText(
	request: APIRequestContext,
	path: string,
): Promise<string> {
	const response = await request.get(`/v1/files/${path}`, { headers: AUTH });
	return response.ok() ? response.text() : "";
}

async function createNote(
	request: APIRequestContext,
	note: RewriteNote,
): Promise<void> {
	const created = await request.put(`/v1/files/${note.path}`, {
		headers: { ...AUTH, "if-none-match": "*" },
		data: markdown(note, SECOND),
	});
	expect(created.status()).toBe(201);
	await expect.poll(() => remoteHas(note.path), { timeout: 15_000 }).toBe(true);
}

async function deleteNote(
	request: APIRequestContext,
	note: RewriteNote,
): Promise<void> {
	const response = await request.get(`/v1/files/${note.path}`, {
		headers: AUTH,
	});
	const etag = response.headers().etag;
	if (response.ok() && etag)
		await request.delete(`/v1/files/${note.path}`, {
			headers: { ...AUTH, "if-match": etag },
		});
}

function paragraph(page: Page, text: string) {
	return page
		.locator(".bn-editor .bn-inline-content", { hasText: text })
		.first();
}

/** Opens the note with the caret at the end of the second paragraph. */
async function placeCaretInSecond(page: Page, note: RewriteNote): Promise<void> {
	await page.addInitScript((token) => {
		window.MEMORIA_REMOTE_URL = window.location.origin;
		window.MEMORIA_REMOTE_TOKEN = token;
	}, COLLAB_TOKEN);
	await page.goto(`/?note=${note.path}`, { waitUntil: "networkidle" });
	const second = paragraph(page, SECOND);
	await expect(second).toBeVisible({ timeout: 15_000 });
	await second.click();
	await page.keyboard.press("End");
}

/** The server pulls the desktop push now (the e2e server has no fetch timer, TOL-234). */
async function serverTakesInTheRewrite(
	page: Page,
	request: APIRequestContext,
	note: RewriteNote,
): Promise<void> {
	pushDesktopRewrite(note);
	const synced = await request.post("/v1/sync", { headers: AUTH });
	expect(synced.ok()).toBe(true);
	await expect(paragraph(page, REWRITTEN)).toBeVisible({ timeout: 15_000 });
}

test("a desktop rewrite of the paragraph under the caret keeps the caret there", async ({
	page,
	request,
}, testInfo) => {
	const note = noteFor(testInfo.project.name);
	await createNote(request, note);
	try {
		await placeCaretInSecond(page, note);
		await serverTakesInTheRewrite(page, request, note);
		await page.keyboard.type(note.typed);

		const expected = markdown(note, `${REWRITTEN}${note.typed}`);
		await expect(paragraph(page, note.typed)).toHaveText(
			`${REWRITTEN}${note.typed}`,
		);
		await expect(paragraph(page, "Third paragraph.")).toHaveText(
			"Third paragraph.",
		);
		await expect
			.poll(() => serverText(request, note.path), { timeout: 20_000 })
			.toBe(expected);
	} finally {
		await page.close();
		// Later projects of the run share the server: leave the seeded list as it was.
		await deleteNote(request, note);
	}
});
