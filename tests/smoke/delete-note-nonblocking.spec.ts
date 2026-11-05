import { expect, test } from "@playwright/test";
import { APP_COMMAND_IDS } from "../../src/hooks/appCommandCatalog";
import {
	createFixtureVaultCopy,
	openFixtureVaultDesktopHarness,
	removeFixtureVaultCopy,
} from "../helpers/fixtureVault";
import { triggerShortcutCommand } from "./testBridge";

let tempVaultDir: string;

test.describe("responsive note deletion", () => {
	test.beforeEach(() => {
		tempVaultDir = createFixtureVaultCopy();
	});

	test.afterEach(() => {
		removeFixtureVaultCopy(tempVaultDir);
	});

	test("keyboard delete keeps the app responsive while deletion is in flight @smoke", async ({
		page,
	}) => {
		await openFixtureVaultDesktopHarness(page, tempVaultDir);
		await page.getByText("Alpha Project", { exact: true }).first().click();
		await expect(
			page.getByRole("heading", { name: "Alpha Project", level: 1 }),
		).toBeVisible({ timeout: 5_000 });

		await page.evaluate(() => {
			const handlers = window.__mockHandlers;
			if (!handlers)
				throw new Error("Mock handlers unavailable for delete override");
			const delayedDelete = (args?: { paths?: string[] }) =>
				new Promise((resolve) => {
					const testWindow = window as typeof window & {
						__resolveDelete?: () => void;
					};
					testWindow.__resolveDelete = () => resolve(args?.paths ?? []);
				});
			handlers.batch_delete_notes = delayedDelete;
			handlers.batch_delete_notes_async = delayedDelete;
		});

		await triggerShortcutCommand(page, APP_COMMAND_IDS.noteDelete);
		await expect(page.getByTestId("confirm-delete-dialog")).toBeVisible({
			timeout: 5_000,
		});

		await expect(page.getByTestId("confirm-delete-btn")).toBeFocused();
		await page.keyboard.press("Enter");

		const progressNotice = page.getByTestId("delete-progress-notice");
		await expect(progressNotice).toContainText("Deleting note...");

		// Deletion opens the adjacent note, then focuses the list on the next frame.
		// Wait for that handoff so it cannot steal focus back from quick open.
		await expect(page.getByTestId("confirm-delete-dialog")).toHaveCount(0);
		await expect(page.getByTestId("note-list-container")).toBeFocused();
		await triggerShortcutCommand(page, APP_COMMAND_IDS.fileQuickOpen);
		const quickOpenInput = page.locator('input[placeholder="Search notes..."]');
		await expect(quickOpenInput).toBeVisible({ timeout: 5_000 });
		await quickOpenInput.fill("Note B");
		const palette = page.getByTestId("quick-open-palette");
		await expect(
			palette
				.locator(".bg-accent")
				.getByRole("button")
				.filter({ has: page.getByText("Note B", { exact: true }) }),
		).toBeVisible();
		await expect(quickOpenInput).toBeFocused();
		await quickOpenInput.press("Enter");

		await expect(
			page.getByRole("heading", { name: "Note B", level: 1 }),
		).toBeVisible({ timeout: 5_000 });
		await expect(progressNotice).toBeVisible();
		await page.evaluate(() => {
			const { __resolveDelete: resolveDelete } = window as typeof window & {
				__resolveDelete?: () => void;
			};
			if (!resolveDelete) throw new Error("Delete resolver was not registered");
			resolveDelete();
		});
		await expect(progressNotice).toHaveCount(0, { timeout: 5_000 });
		await expect(page.getByText("Note permanently deleted")).toBeVisible({
			timeout: 5_000,
		});
	});

	test("breadcrumb delete menu responds to a single pointer click @smoke", async ({
		page,
	}) => {
		await openFixtureVaultDesktopHarness(page, tempVaultDir);
		await page.getByText("Alpha Project", { exact: true }).first().click();
		await expect(
			page.getByRole("heading", { name: "Alpha Project", level: 1 }),
		).toBeVisible({ timeout: 5_000 });

		await page.getByRole("button", { name: "More note actions" }).click();
		const menu = page.getByRole("menu");
		const deleteItem = menu.getByRole("menuitem", { name: "Delete this note" });
		await expect(deleteItem).toBeVisible({ timeout: 5_000 });

		await deleteItem.click();

		await expect(page.getByTestId("confirm-delete-dialog")).toBeVisible({
			timeout: 5_000,
		});
		await expect(page.getByTestId("confirm-delete-btn")).toBeFocused();
	});
});
