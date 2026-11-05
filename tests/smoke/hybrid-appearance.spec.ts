import { expect, test } from "@playwright/test";

test("Hybrid keeps the sidebar dark and editor light", async ({ page }) => {
	await page.goto("/");
	await page.waitForLoadState("networkidle");
	await page.getByRole("button", { name: "Open settings" }).click();

	const settings = page.locator('[data-testid="settings-panel"]');
	await expect(settings).toBeVisible();
	await page.locator('[data-testid="settings-theme-hybrid"]').click();
	await page.locator('[data-testid="settings-save"]').click();

	const sidebar = page.locator(".app__sidebar");
	const editor = page.locator(".app__editor");
	await expect(sidebar).toHaveAttribute("data-theme", "dark");
	await expect
		.poll(() =>
			sidebar.evaluate((element) =>
				getComputedStyle(element).getPropertyValue("--surface-app").trim(),
			),
		)
		.toBe("#1F1E1B");
	await expect
		.poll(() =>
			editor.evaluate((element) =>
				getComputedStyle(element).getPropertyValue("--surface-app").trim(),
			),
		)
		.toBe("#FFFFFF");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
