import { execFileSync } from "node:child_process";
import {
	type APIRequestContext,
	type BrowserContext,
	expect,
	type Page,
	test,
} from "@playwright/test";
import { COLLAB_TOKEN, REMOTE_GIT_DIR } from "../playwright.config";

/**
 * TOL-22: renaming a note on the web renames it on the server and rewrites the wikilinks to it
 * in every other note in the same commit, as the desktop does. A note that links to it and is
 * open elsewhere gets the new links in its live document, without a reload.
 */

test.describe.configure({ retries: 0 });

const AUTH = { authorization: `Bearer ${COLLAB_TOKEN}` };

/** A vault-relative note path. */
type NotePath = string;
/** A wikilink target as the editor keeps it: path stem, maybe `|alias`. */
type LinkTarget = string;

interface SeededNote {
	path: NotePath;
	title: string;
	content: string;
}

async function configureRemoteVault(context: BrowserContext): Promise<void> {
	await context.addInitScript((token) => {
		window.MEMORIA_REMOTE_URL = window.location.origin;
		window.MEMORIA_REMOTE_TOKEN = token;
	}, COLLAB_TOKEN);
}

async function createNote(
	request: APIRequestContext,
	{ path, content }: SeededNote,
): Promise<void> {
	const response = await request.put(`/v1/files/${path}`, {
		headers: { ...AUTH, "if-none-match": "*" },
		data: content,
	});
	expect(response.status()).toBe(201);
}

/** Deletes a note this test made, so the shared vault's note list stays as the other specs expect. */
async function deleteNote(request: APIRequestContext, path: NotePath): Promise<void> {
	const read = await request.get(`/v1/files/${path}`, { headers: AUTH });
	const etag = read.headers().etag;
	if (!read.ok() || !etag) return;
	await request.delete(`/v1/files/${path}`, { headers: { ...AUTH, "if-match": etag } });
}

async function serverContent(
	request: APIRequestContext,
	path: NotePath,
): Promise<string> {
	const response = await request.get(`/v1/files/${path}`, { headers: AUTH });
	return response.ok() ? response.text() : "";
}

/** The newest commit on the git remote, what the desktop pulls next: its files (indented) and subject, sorted. */
function lastRemoteCommit(): string[] {
	return execFileSync(
		"git",
		["--git-dir", REMOTE_GIT_DIR, "log", "-1", "--no-renames", "--format=%s", "--name-only", "main"],
		{ encoding: "utf8" },
	)
		.split("\n")
		.filter(Boolean)
		.map((line, index) => (index === 0 ? line : `  ${line}`))
		.sort();
}

/** Opens a note by its deep link (TOL-175): the list holds every other project's notes too. */
async function openNote(page: Page, { path, title }: SeededNote): Promise<void> {
	await page.goto(`/?note=${encodeURIComponent(path)}`, { waitUntil: "load" });
	await expect(page.locator(".bn-editor")).toBeVisible({ timeout: 10_000 });
	await expect(page.locator(".bn-editor h1").first()).toHaveText(title, { timeout: 10_000 });
}

function liveLink(page: Page, target: LinkTarget) {
	return page.locator(`.bn-editor .wikilink[data-target="${target}"]`);
}

test("renaming a note on the web rewrites the links to it in one commit", async ({
	browser,
	request,
}, testInfo) => {
	const stamp = `${testInfo.project.name}-${Date.now()}`;
	const folder = `rename-${stamp}`;
	const target: SeededNote = {
		path: `${folder}/target.md`,
		title: `Target ${stamp}`,
		content: `# Target ${stamp}\n\nBody.\n`,
	};
	const linkerTitle = `Linker ${stamp}`;
	const linker: SeededNote = {
		path: `${folder}/linker.md`,
		title: linkerTitle,
		content: `# ${linkerTitle}\n\nSee [[${folder}/target]] and [[${target.title}|the target]].\n`,
	};
	const renamedStem = `renamed-${stamp}`;
	await createNote(request, target);
	await createNote(request, linker);

	const context = await browser.newContext(testInfo.project.use);
	try {
		await configureRemoteVault(context);
		const reader = await context.newPage();
		await openNote(reader, linker);
		await expect(liveLink(reader, `${folder}/target`)).toBeVisible();

		const page = await context.newPage();
		await openNote(page, target);
		await page.getByTestId("breadcrumb-filename-trigger").dblclick();
		await page.getByTestId("breadcrumb-filename-input").fill(renamedStem);
		await page.getByTestId("breadcrumb-filename-input").press("Enter");

		await expect(page.getByText("Updated 1 note")).toBeVisible({ timeout: 10_000 });
		const renamed = `${folder}/${renamedStem}`;
		await expect
			.poll(() => serverContent(request, linker.path), { timeout: 10_000 })
			.toBe(`# ${linkerTitle}\n\nSee [[${renamed}]] and [[${renamed}|the target]].\n`);
		expect(await serverContent(request, `${renamed}.md`)).toBe(target.content);
		// One commit holds the move and the rewrite, and it reached the remote.
		await expect
			.poll(() => lastRemoteCommit(), { timeout: 10_000 })
			.toEqual([
				`  ${folder}/linker.md`,
				`  ${renamed}.md`,
				`  ${folder}/target.md`,
				`Rename ${folder}/target.md to ${renamed}.md`,
			]);

		// The linking note, open in the other tab, shows the new links without a reload.
		await expect(liveLink(reader, renamed)).toBeVisible({ timeout: 10_000 });
		await expect(liveLink(reader, `${renamed}|the target`)).toBeVisible();
		await expect(liveLink(reader, `${folder}/target`)).toHaveCount(0);
	} finally {
		await context.close();
		for (const path of [target.path, linker.path, `${folder}/${renamedStem}.md`]) {
			await deleteNote(request, path);
		}
	}
});
