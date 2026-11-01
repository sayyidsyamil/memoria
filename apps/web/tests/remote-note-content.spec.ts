import { expect, test, type Page } from "@playwright/test";

/**
 * Test for TOL-196: verifies that the web app loads note bodies through the
 * remote VaultBackend when MEMORIA_REMOTE_URL is configured.
 */

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

test("opens note and displays body content from remote backend", async ({
	page,
}) => {
	await configureRemoteVault(page);
	await page.goto("/", { waitUntil: "networkidle" });
	await waitForNoteList(page);

	// Click on a note to open it
	await page
		.getByTestId("note-list-container")
		.getByText("Welcome", { exact: true })
		.click();

	// Wait for editor to be visible
	await expect(page.locator(".bn-editor")).toBeVisible({ timeout: 5000 });

	// Wait for content blocks to appear (not just the editor container)
	await expect(page.locator(".bn-block").first()).toBeVisible({ timeout: 5000 });

	// Verify that the editor contains actual note content
	// The Welcome note should have "Welcome to Memoria" in it
	const editorContent = await page
		.locator(".bn-editor")
		.textContent({ timeout: 5000 });

	expect(editorContent).toBeTruthy();
	expect(editorContent).not.toBeNull();
	if (editorContent) {
		expect(editorContent.length).toBeGreaterThan(0);
	}
	expect(editorContent).toContain("Welcome");
});

test("loads note content in editor without showing empty state", async ({
	page,
}) => {
	await configureRemoteVault(page);
	await page.goto("/", { waitUntil: "networkidle" });
	await waitForNoteList(page);

	// Open a note
	await page
		.getByTestId("note-list-container")
		.getByText("Welcome", { exact: true })
		.click();

	// Editor should not show empty state - it should have content
	await expect(page.locator(".bn-editor")).toBeVisible({ timeout: 5000 });

	// Check that the editor has blocks (not empty)
	const blockCount = await page.locator(".bn-block").count();
	expect(blockCount).toBeGreaterThan(0);
});

/** The phone shows the note or the list (TOL-193): back to the list there; true on a phone. */
async function showNoteList(page: Page): Promise<boolean> {
	const back = page.getByTestId("phone-back-to-notes");
	if (!(await back.isVisible())) return false;
	await back.click();
	return true;
}

test("note content cache uses remote backend for reloads", async ({ page }) => {
	await configureRemoteVault(page);
	await page.goto("/", { waitUntil: "networkidle" });
	await waitForNoteList(page);

	// Open a note
	await page
		.getByTestId("note-list-container")
		.getByText("Welcome", { exact: true })
		.click();

	// Wait for content to load - wait for blocks, not just the editor container
	await expect(page.locator(".bn-editor")).toBeVisible({ timeout: 5000 });
	await expect(page.locator(".bn-block").first()).toBeVisible({ timeout: 5000 });
	const initialContent = await page.locator(".bn-editor").textContent();

	// Close and reopen the same note
	await page.keyboard.press("Escape");
	await showNoteList(page);
	await page
		.getByTestId("note-list-container")
		.getByText("Welcome", { exact: true })
		.click();

	// Content should load again from cache/remote - wait for blocks again
	await expect(page.locator(".bn-editor")).toBeVisible({ timeout: 5000 });
	await expect(page.locator(".bn-block").first()).toBeVisible({ timeout: 5000 });
	const reloadedContent = await page.locator(".bn-editor").textContent();

	expect(reloadedContent).toBeTruthy();
	expect(reloadedContent).toEqual(initialContent);
});
