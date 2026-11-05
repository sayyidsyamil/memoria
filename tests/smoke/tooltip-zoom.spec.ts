import { expect, test } from "@playwright/test";
import {
	createFixtureVaultCopy,
	openFixtureVault,
	removeFixtureVaultCopy,
} from "../helpers/fixtureVault";

for (const zoom of [80, 90, 100, 110, 125, 150]) {
	test(`tooltip arrow stays anchored at ${zoom}%`, async ({ page }) => {
		const vault = createFixtureVaultCopy();
		try {
			await openFixtureVault(page, vault);
			await page.evaluate((level) => {
				const root = document.documentElement.style;
				root.setProperty("zoom", `${level}%`);
				root.setProperty("--memoria-overlay-zoom-factor", String(level / 100));
				root.setProperty("--memoria-overlay-zoom-inverse", String(100 / level));
				window.dispatchEvent(new Event("laputa-zoom-change"));
			}, zoom);
			await page
				.getByTestId("note-title-row")
				.filter({ hasText: "Alpha Project" })
				.click();
			const trigger = page.getByRole("button", {
				name: "Open note's neighborhood",
				exact: true,
			});
			await trigger.hover();
			const tooltip = page.locator('[data-slot="tooltip-content"]');
			await expect(tooltip).toBeVisible();
			await expect
				.poll(async () => {
					const anchor = await trigger.boundingBox();
					const arrow = await tooltip.locator("svg").boundingBox();
					if (!anchor || !arrow) return Number.POSITIVE_INFINITY;
					return Math.abs(
						arrow.x + arrow.width / 2 - anchor.x - anchor.width / 2,
					);
				})
				.toBeLessThan(3);
			const bounds = await tooltip.boundingBox();
			expect(bounds).not.toBeNull();
			expect(bounds?.x).toBeGreaterThanOrEqual(0);
			expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(1280);
			await page.mouse.move(600, 400, { steps: 10 });
			await expect(tooltip).toBeHidden();
		} finally {
			removeFixtureVaultCopy(vault);
		}
	});
}
