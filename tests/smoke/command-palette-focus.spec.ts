import { expect, test } from "@playwright/test";
import { openCommandPalette } from "./helpers";

test("palette shortcut uses app navigation instead of the covered page center", async ({
	page,
}) => {
	test.setTimeout(5_000);
	await page.setContent(`
    <style>body { margin: 0; height: 100vh; }
      #overlay { position: fixed; inset: 30%; background: white; }</style>
    <nav data-testid="sidebar-top-nav"><button>All Notes</button></nav>
    <iframe id="overlay" title="Embedded document" srcdoc="Embedded document"></iframe>
    <input placeholder="Type a command..." hidden>
  `);
	await page.evaluate(() => {
		window.__laputaTest = {
			dispatchBrowserMenuCommand: (id) => {
				document.body.dataset.menuCommand = id;
			},
		};
		window.addEventListener("keydown", (event) => {
			if (event.key !== "k") return;
			const commandModifier = event.ctrlKey || event.metaKey;
			if (!commandModifier) return;
			event.preventDefault();
			document.querySelector("input")?.removeAttribute("hidden");
		});
	});

	await openCommandPalette(page);

	await expect(page.getByPlaceholder("Type a command...")).toBeVisible();
});
