import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
	createFixtureVaultCopy,
	openFixtureVault,
	removeFixtureVaultCopy,
} from "../helpers/fixtureVault";

async function readSavedNote(page: Page, note: string): Promise<string> {
	const response = await page.request.get(
		`/api/vault/content?path=${encodeURIComponent(note)}`,
	);
	expect(response.ok()).toBe(true);
	const body: { content: string } = await response.json();
	return body.content;
}

test("typing after clicking an embedded image preserves the image and saves edits @smoke", async ({
	page,
}) => {
	const vault = createFixtureVaultCopy();
	const note = path.join(vault, "note", "note-b.md");
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="180"><rect width="400" height="180" fill="#2f6fed"/><!--${"A".repeat(512 * 1024)}--></svg>`;
	const imageUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		const seeded = await page.request.post("/api/vault/save", {
			data: {
				path: note,
				content: `---\ntitle: Note B\n---\n# Note B\n\n![Photo](${imageUrl})\n\nContinue here\n`,
			},
		});
		expect(seeded.ok()).toBe(true);

		await openFixtureVault(page, vault);
		await page
			.getByTestId("note-list-container")
			.getByText("Note B", { exact: true })
			.click();
		const editor = page.locator(".bn-editor");
		await editor.locator("img.bn-visual-media").click();
		await editor
			.locator('[data-content-type="paragraph"]')
			.filter({ hasText: "Continue here" })
			.click();
		await page.keyboard.press("End");
		await page.keyboard.type(" after image click");
		await expect
			.poll(() => readSavedNote(page, note))
			.toContain("Continue here after image click");
		expect(await readSavedNote(page, note)).toContain(imageUrl);
		await page
			.getByTestId("note-list-container")
			.getByText("Note C", { exact: true })
			.click();
		await page
			.getByTestId("note-list-container")
			.getByText("Note B", { exact: true })
			.click();
		await expect(editor).toContainText("Continue here after image click");
		await expect(editor.locator("img.bn-visual-media")).toHaveCount(1);
		expect(errors).toEqual([]);
	} finally {
		removeFixtureVaultCopy(vault);
	}
});
