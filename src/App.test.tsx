import "./App.testUtils";
import {
	act,
	fireEvent,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import {
	mockAllContent,
	mockCommandResults,
	mockEntries,
	render,
	SLOW_APP_READY_TIMEOUT_MS,
} from "./App.testUtils";
import { formatShortcutDisplay } from "./hooks/appCommandCatalog";
import type { ViewDefinition, ViewFile } from "./types";

describe("App", () => {
	it("renders the four-panel layout", async () => {
		render(<App />);
		expect(
			await screen.findByText("All Notes", {}, { timeout: 5000 }),
		).toBeInTheDocument();
	});

	it("creates custom views with a portable fallback filename for symbol-only names", async () => {
		const savedViews: ViewFile[] = [];
		const saveView = vi.fn(
			({
				filename,
				definition,
			}: {
				filename: string;
				definition: ViewDefinition;
			}) => {
				if (filename === ".yml") throw new Error("Invalid view filename");
				savedViews.push({ filename, definition });
				return null;
			},
		);
		mockCommandResults.save_view_cmd = saveView;
		mockCommandResults.list_views = () => savedViews;
		mockCommandResults.reload_vault = mockEntries;

		render(<App />);

		await screen.findByText("All Notes");
		fireEvent.click(screen.getByRole("button", { name: "Create view" }));
		const dialog = await screen.findByRole("dialog");
		fireEvent.change(
			within(dialog).getByPlaceholderText(/Active Projects|Reading List/i),
			{
				target: { value: "🚀" },
			},
		);
		fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));

		await waitFor(() => {
			expect(saveView).toHaveBeenCalledWith(
				expect.objectContaining({
					filename: "view.yml",
					definition: expect.objectContaining({ name: "🚀" }),
				}),
			);
		});
	}, 10000);

	it("loads and displays vault entries in sidebar", async () => {
		render(<App />);
		await waitFor(
			() => {
				// Entries appear in both Sidebar and NoteList
				expect(screen.getAllByText("Test Project").length).toBeGreaterThan(0);
				expect(
					screen.getAllByText("Software Development").length,
				).toBeGreaterThan(0);
			},
			{ timeout: SLOW_APP_READY_TIMEOUT_MS },
		);
	});

	it("keeps one startup shell visible while the initial vault note scan is pending", async () => {
		let resolveListVault: ((value: typeof mockEntries) => void) | null = null;
		const listVaultPromise = new Promise<typeof mockEntries>((resolve) => {
			resolveListVault = resolve;
		});
		mockCommandResults.list_vault = () => listVaultPromise;

		render(<App />);

		expect(
			await screen.findByTestId(
				"startup-shell-fallback",
				{},
				{ timeout: 5000 },
			),
		).toBeInTheDocument();
		expect(
			screen.queryByTestId("sidebar-loading-favorites"),
		).not.toBeInTheDocument();
		expect(
			screen.queryByTestId("note-list-loading-skeleton"),
		).not.toBeInTheDocument();
		expect(
			screen.queryByTestId("status-vault-reloading"),
		).not.toBeInTheDocument();

		await act(async () => {
			resolveListVault?.(mockEntries);
			await Promise.resolve();
		});

		await waitFor(() => {
			expect(
				screen.queryByTestId("startup-shell-fallback"),
			).not.toBeInTheDocument();
			expect(
				screen.queryByTestId("note-list-loading-skeleton"),
			).not.toBeInTheDocument();
			expect(screen.getAllByText("Test Project").length).toBeGreaterThan(0);
		});
	});

	it("shows empty state in editor when no note is selected", async () => {
		render(<App />);
		await waitFor(() => {
			expect(
				screen.getByText("Select a note to start editing"),
			).toBeInTheDocument();
		});
	});

	it(
		"opens a note window after loading the active vault graph",
		async () => {
			const listVault = vi.fn(() => mockEntries);
			const reloadVaultEntry = vi.fn(
				({ path }: { path: string }) =>
					mockEntries.find((entry) => entry.path === path) ?? null,
			);
			const getNoteContent = vi.fn(
				({ path }: { path: string }) =>
					new Map(Object.entries(mockAllContent)).get(path) ?? "",
			);
			mockCommandResults.list_vault = listVault;
			mockCommandResults.reload_vault_entry = reloadVaultEntry;
			mockCommandResults.get_note_content = getNoteContent;
			window.history.replaceState(
				{},
				"",
				"/?window=note&path=%2Fvault%2Fproject%2Ftest.md&vault=%2Fvault&title=Test+Project",
			);

			render(<App />);

			await waitFor(() => expect(reloadVaultEntry).toHaveBeenCalled());
			expect(reloadVaultEntry).toHaveBeenCalledWith({
				path: "/vault/project/test.md",
				vaultPath: "/vault",
			});
			await waitFor(() => expect(getNoteContent).toHaveBeenCalled());
			expect(getNoteContent).toHaveBeenCalledWith({
				path: "/vault/project/test.md",
				vaultPath: "/vault",
			});
			await waitFor(() =>
				expect(window.__laputaTest?.activeTabPath).toBe(
					"/vault/project/test.md",
				),
			);
			expect(
				await screen.findByTestId(
					"blocknote-view",
					{},
					{ timeout: SLOW_APP_READY_TIMEOUT_MS },
				),
			).toHaveAttribute("data-editable", "true");
			expect(listVault).toHaveBeenCalled();
		},
		SLOW_APP_READY_TIMEOUT_MS * 2,
	);

	it("shows keyboard shortcut hints", async () => {
		const quickOpenHint = formatShortcutDisplay({ display: "⌘P / ⌘O" });
		const newNoteHint = formatShortcutDisplay({ display: "⌘N" });
		const { container } = render(<App />);
		await screen.findByText("Select a note to start editing");

		await waitFor(() => {
			const visibleText = container.textContent ?? "";
			expect(visibleText).toContain(`${quickOpenHint} to search`);
			expect(visibleText).toContain(`${newNoteHint} to create`);
		});
	});

	it("registers keyboard shortcuts without error", async () => {
		render(<App />);
		await waitFor(() => {
			expect(screen.getByText("All Notes")).toBeInTheDocument();
		});

		// Cmd+S with no pending changes shows "Nothing to save"
		fireEvent.keyDown(window, { key: "s", metaKey: true });
		await waitFor(() => {
			expect(screen.getByText("Nothing to save")).toBeInTheDocument();
		});
	});

	it("persists a Cmd+N note before opening it in the editor", async () => {
		const dateNow = vi.spyOn(Date, "now").mockReturnValue(1700000000000);
		let resolveSave!: () => void;
		const saveNoteContent = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveSave = resolve;
				}),
		);
		mockCommandResults.save_note_content = saveNoteContent;

		try {
			render(<App />);
			await screen.findByText("All Notes");

			fireEvent.keyDown(window, { key: "n", code: "KeyN", metaKey: true });

			await waitFor(() => {
				expect(saveNoteContent).toHaveBeenCalledWith({
					path: "/vault/untitled-note-1700000000.md",
					content: "---\ntype: Note\n---\n\n# \n\n",
					vaultPath: "/vault",
				});
			});
			expect(window.__laputaTest?.activeTabPath).not.toBe(
				"/vault/untitled-note-1700000000.md",
			);

			await act(async () => {
				resolveSave();
				await Promise.resolve();
			});

			await waitFor(() => {
				expect(window.__laputaTest?.activeTabPath).toBe(
					"/vault/untitled-note-1700000000.md",
				);
			});
			expect(
				screen.getAllByText("Untitled Note 1700000000").length,
			).toBeGreaterThan(0);
		} finally {
			dateNow.mockRestore();
		}
	});
});
