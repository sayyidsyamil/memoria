import { expect, test } from "@playwright/test";
import {
	createFixtureVaultCopy,
	openFixtureVaultTauri,
	removeFixtureVaultCopy,
} from "../helpers/fixtureVault";
import { seedBlockNoteTable, triggerMenuCommand } from "./testBridge";

test("table breaks survive saving and reloading @smoke", async ({ page }) => {
	test.setTimeout(60000);
	const vault = createFixtureVaultCopy();
	try {
		await openFixtureVaultTauri(page, vault);
		await triggerMenuCommand(page, "file-new-note");
		await expect(page.locator(".bn-editor")).toBeVisible();
		await seedBlockNoteTable(page, [180, 180]);
		const cell = page.locator("table td").first();
		await cell.click();
		await page.keyboard.press("End");
		await page.keyboard.type("before");
		await page.keyboard.press("Enter");
		await page.keyboard.type("after");
		await page.keyboard.press("Shift+Enter");
		await page.keyboard.type("last");
		await triggerMenuCommand(page, "file-save");
		await expect(
			page.getByRole("option").filter({ hasText: "before<br>after<br>last" }),
		).toBeVisible({ timeout: 15000 });
		await page.reload();
		await page
			.getByRole("option")
			.filter({ hasText: "before<br>after<br>last" })
			.click();
		await expect(page.locator("table td").first()).toContainText("before");
		await expect(page.locator("table td").first()).toContainText("after");
		await expect(page.locator("table td").first()).toContainText("last");
		await expect(page.locator("table td").first().locator("br")).toHaveCount(2);
		await page.locator("table td").first().click();
		await page.keyboard.press("Tab");
		await page.keyboard.type("navigation works");
		await expect(page.locator("table")).toContainText("navigation works");
	} finally {
		removeFixtureVaultCopy(vault);
	}
});
