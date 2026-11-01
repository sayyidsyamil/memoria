import { expect, type Page, test } from "@playwright/test";
import {
	createFixtureVaultCopy,
	openFixtureVault,
	removeFixtureVaultCopy,
} from "../helpers/fixtureVault";

const zoomLevels = [80, 90, 100, 110, 125, 150];

async function setZoom(page: Page, zoom: number): Promise<void> {
	await page.evaluate((level) => {
		const root = document.documentElement.style;
		root.setProperty("zoom", `${level}%`);
		root.setProperty("--memoria-overlay-zoom-factor", String(level / 100));
		root.setProperty("--memoria-overlay-zoom-inverse", String(100 / level));
		window.dispatchEvent(new Event("laputa-zoom-change"));
	}, zoom);
}

let fixtureVault: string | null = null;

test.beforeEach(async ({ page }) => {
	fixtureVault = createFixtureVaultCopy();
	await openFixtureVault(page, fixtureVault);
	await page
		.getByTestId("note-title-row")
		.filter({ hasText: "Alpha Project" })
		.click();
});

test.afterEach(() => {
	if (fixtureVault) removeFixtureVaultCopy(fixtureVault);
	fixtureVault = null;
});

for (const zoom of zoomLevels) {
	test(`toolbar tooltip arrow stays anchored at ${zoom}%`, async ({ page }) => {
		await setZoom(page, zoom);
		const trigger = page.getByRole("button", {
			name: "Open note's neighborhood",
			exact: true,
		});
		await expect(trigger).toBeVisible();
		await trigger.hover();

		const tooltip = page.locator('[data-slot="tooltip-content"]');
		await expect(tooltip).toBeVisible();
		const arrow = tooltip.locator("svg");
		await expect
			.poll(async () => {
				const triggerBox = await trigger.boundingBox();
				const arrowBox = await arrow.boundingBox();
				if (!triggerBox || !arrowBox) return Number.POSITIVE_INFINITY;
				return Math.abs(
					arrowBox.x + arrowBox.width / 2 - triggerBox.x - triggerBox.width / 2,
				);
			})
			.toBeLessThan(3);

		const tooltipBox = await tooltip.boundingBox();
		const viewport = page.viewportSize();
		expect(tooltipBox).not.toBeNull();
		expect(viewport).not.toBeNull();
		if (!tooltipBox || !viewport) return;
		expect(tooltipBox.x).toBeGreaterThanOrEqual(0);
		expect(tooltipBox.y).toBeGreaterThanOrEqual(0);
		expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(viewport.width);
		expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(
			viewport.height,
		);

		await page.mouse.move(600, 400, { steps: 10 });
		await expect(tooltip).toBeHidden();
	});
}

test("sidebar tooltip stays centered at 125%", async ({ page }) => {
	await setZoom(page, 125);
	const trigger = page.getByRole("button", { name: "Collapse sidebar" });
	await expect(trigger).toBeVisible();
	await trigger.hover();

	const tooltip = page.locator('[data-slot="tooltip-content"]');
	await expect(tooltip).toBeVisible();
	const triggerBox = await trigger.boundingBox();
	const arrowBox = await tooltip.locator("svg").boundingBox();
	expect(triggerBox).not.toBeNull();
	expect(arrowBox).not.toBeNull();
	if (!triggerBox || !arrowBox) return;

	const side = await tooltip.getAttribute("data-side");
	const arrowAxisOffset = ["left", "right"].includes(side ?? "")
		? Math.abs(
				arrowBox.y + arrowBox.height / 2 - triggerBox.y - triggerBox.height / 2,
			)
		: Math.abs(
				arrowBox.x + arrowBox.width / 2 - triggerBox.x - triggerBox.width / 2,
			);
	expect(arrowAxisOffset).toBeLessThan(3);
});
