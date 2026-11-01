import { execFileSync } from "node:child_process";
import {
	type APIRequestContext,
	expect,
	type Page,
	test,
} from "@playwright/test";
import { COLLAB_TOKEN, REMOTE_GIT_DIR } from "../playwright.config";

/**
 * TOL-204: an image pasted into a note on the web is stored on the server under
 * attachments/, linked with the portable path the desktop app writes, shown through the
 * authorized resolver, and pushed so the desktop app gets both after a pull. Attachment
 * requests without the session's token are refused, and so is importing from an internal
 * address.
 */

const AUTH = { authorization: `Bearer ${COLLAB_TOKEN}` };
// A 1x1 PNG: small, and a real image the browser decodes.
const PIXEL_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const BODY_LINE = "Paste the screenshot here.";
const DESKTOP_PROJECTS = ["chromium", "webkit"];

test.describe.configure({ retries: 0 });

async function configureRemoteVault(page: Page): Promise<void> {
	await page.addInitScript((token) => {
		window.MEMORIA_REMOTE_URL = window.location.origin;
		window.MEMORIA_REMOTE_TOKEN = token;
	}, COLLAB_TOKEN);
}

function remoteGit(args: string[]): string {
	return execFileSync("git", ["--git-dir", REMOTE_GIT_DIR, ...args], {
		encoding: "utf8",
	});
}

/** What the desktop app gets after a pull, or null while it is not pushed yet. */
function pushed(path: string): string | null {
	try {
		return remoteGit(["show", `main:${path}`]);
	} catch {
		return null;
	}
}

async function createNote(
	request: APIRequestContext,
	path: string,
	title: string,
): Promise<void> {
	const response = await request.put(`/v1/files/${path}`, {
		headers: { ...AUTH, "if-none-match": "*" },
		data: `---\ntype: Note\n---\n# ${title}\n\n${BODY_LINE}\n`,
	});
	expect(response.status()).toBe(201);
}

async function openNote(page: Page, title: string): Promise<void> {
	await page.goto("/", { waitUntil: "load" });
	const noteList = page.getByTestId("note-list-container");
	await expect(noteList.getByText(title, { exact: true })).toBeVisible({
		timeout: 15_000,
	});
	await noteList.getByText(title, { exact: true }).click();
	await expect(
		page.locator(".bn-editor .bn-inline-content", { hasText: BODY_LINE }).first(),
	).toBeVisible({ timeout: 10_000 });
}

/** Pastes an image file the way a browser does when the clipboard holds a screenshot. */
async function pasteImage(page: Page): Promise<void> {
	await page
		.locator(".bn-editor .bn-inline-content", { hasText: BODY_LINE })
		.first()
		.click();
	await page.keyboard.press("End");
	await page.evaluate((base64) => {
		const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
		const data = new DataTransfer();
		data.items.add(new File([bytes], "pasted shot.png", { type: "image/png" }));
		const event = new Event("paste", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "clipboardData", { value: data });
		document.activeElement?.dispatchEvent(event);
	}, PIXEL_PNG);
}

async function expectDecodedImage(page: Page): Promise<void> {
	const image = page.locator(".bn-editor img[src^='blob:']").first();
	await expect(image).toBeVisible({ timeout: 10_000 });
	await expect
		.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
		.toBe(1);
}

test("refuses attachment requests without the session token", async ({
	request,
}) => {
	const anonymous = await request.get("/v1/files/attachments/pixel.png");
	expect(anonymous.status()).toBe(401);
	const wrongToken = await request.get("/v1/files/attachments/pixel.png", {
		headers: { authorization: "Bearer not-the-session-token-0123456789" },
	});
	expect(wrongToken.status()).toBe(401);
	const authorized = await request.get("/v1/files/attachments/pixel.png", {
		headers: AUTH,
	});
	expect(authorized.status()).toBe(200);
});

test("refuses to import an image from an internal address", async ({
	request,
}) => {
	for (const url of [
		"http://169.254.169.254/latest/meta-data/",
		"http://127.0.0.1:41761/healthz",
		"http://[::1]/a.png",
	]) {
		const response = await request.post("/v1/attachments/imports", {
			headers: AUTH,
			data: { url },
		});
		expect(response.status(), url).toBe(400);
	}
});

test("a pasted image shows on the web and reaches the desktop app after a pull", async ({
	page,
	request,
}, testInfo) => {
	test.skip(
		!DESKTOP_PROJECTS.includes(testInfo.project.name),
		"desktop layouts only",
	);
	const title = `Paste ${testInfo.project.name} ${Date.now()}`;
	const notePath = `scratch/${title.toLowerCase().replaceAll(" ", "-")}.md`;
	await createNote(request, notePath, title);
	await configureRemoteVault(page);
	await openNote(page, title);

	const upload = page.waitForResponse(
		(response) =>
			response.request().method() === "PUT" &&
			response.url().includes("/v1/files/attachments/"),
	);
	await pasteImage(page);
	const stored = (await (await upload).json()) as { path: string };
	expect(stored.path).toMatch(/^attachments\/\d+-pasted_shot\.png$/u);
	await expectDecodedImage(page);

	// The note links the portable path, as the desktop app writes it.
	await expect
		.poll(() => pushed(notePath), { timeout: 20_000 })
		.toContain(`(${stored.path})`);
	expect(
		Number(remoteGit(["cat-file", "-s", `main:${stored.path}`]).trim()),
	).toBe(Buffer.from(PIXEL_PNG, "base64").byteLength);

	// The attachment is only served with the token.
	expect((await request.get(`/v1/files/${stored.path}`)).status()).toBe(401);

	// Opened again, the stored note shows the image through the authorized resolver.
	await openNote(page, title);
	await expectDecodedImage(page);
});
