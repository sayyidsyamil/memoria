import { expect, test } from "@playwright/test";
import {
	createFixtureVaultCopy,
	openFixtureVaultTauri,
	removeFixtureVaultCopy,
} from "../helpers/fixtureVault";
import { triggerMenuCommand } from "./testBridge";

// A real PDF stream exercises the bundled worker and canvas, rather than a renderer mock.
function pdfDocument() {
	const stream =
		"0.1 0.4 0.7 rg 40 500 530 180 re f BT /F1 22 Tf 0 0 0 rg 50 450 Td (Imported PDF content) Tj ET";
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
	];
	let pdf = "%PDF-1.4\n";
	const offsets = [0];
	for (const [index, object] of objects.entries()) {
		offsets.push(pdf.length);
		pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
	}
	const xref = pdf.length;
	pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
		.slice(1)
		.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
		.join("")}`;
	return Buffer.from(
		`${pdf}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
	);
}

let vault: string;

test.beforeEach(async ({ page }) => {
	vault = createFixtureVaultCopy();
	await openFixtureVaultTauri(page, vault);
	await page.route("http://asset.localhost/**", (route) =>
		route.fulfill({
			contentType: "application/pdf",
			headers: { "Access-Control-Allow-Origin": "*" },
			body: pdfDocument(),
		}),
	);
	await page.evaluate(() => {
		Object.assign(window.__TAURI_INTERNALS__, {
			convertFileSrc: (path: string) =>
				`http://asset.localhost/${encodeURIComponent(path)}`,
		});
	});
});
test.afterEach(() => removeFixtureVaultCopy(vault));

test("@smoke /File renders imported PDF content inside the saved note", async ({
	page,
}) => {
	test.setTimeout(60000);
	await page.locator("body").click();
	await triggerMenuCommand(page, "file-new-note");
	const title = page
		.locator('.bn-editor [data-content-type="heading"]')
		.first();
	await expect(title).toBeVisible();
	await title.click();
	await page.waitForTimeout(300);
	await page.keyboard.type("Inline PDF preview");
	await page.keyboard.press("Enter");
	await expect(page.getByTestId("breadcrumb-filename-trigger")).toContainText(
		"inline-pdf-preview",
		{ timeout: 10000 },
	);
	await page.keyboard.type("/File");
	await page.getByRole("option", { name: /^File/ }).click();
	await page.locator('input[type="file"]').setInputFiles({
		name: "Album (音楽).pdf",
		mimeType: "application/pdf",
		buffer: pdfDocument(),
	});
	await expect(
		page.locator(".bn-file-block-content-wrapper"),
	).not.toContainText("Add file");
	await page.keyboard.press("Escape");
	const canvas = page.getByTestId("pdf-file-preview").locator("canvas").first();
	await expect(canvas).toBeVisible();
	await expect
		.poll(() =>
			canvas.evaluate((element) => {
				const context = element.getContext("2d");
				const pixel = context?.getImageData(
					Math.floor(element.width / 2),
					Math.floor(element.height / 4),
					1,
					1,
				).data;
				return (
					element.width > 300 && pixel !== undefined && pixel[2] > pixel[0]
				);
			}),
		)
		.toBe(true);
	await page.waitForTimeout(1500);
	await openFixtureVaultTauri(page, vault);
	await page.evaluate(() => {
		Object.assign(window.__TAURI_INTERNALS__, {
			convertFileSrc: (path: string) =>
				`http://asset.localhost/${encodeURIComponent(path)}`,
		});
	});
	await page
		.getByTestId("note-title-row")
		.filter({ hasText: "Inline PDF preview" })
		.click();
	await expect(
		page.getByTestId("pdf-file-preview").locator("canvas").first(),
	).toBeVisible();
});
