import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VaultEntry } from "../types";
import { Sidebar } from "./Sidebar";
import {
	buildSidebarEntry,
	defaultSelection,
	mockEntries,
	renderSidebar,
	requireElement,
} from "./Sidebar.testUtils";

describe("Sidebar.types", () => {
	describe("Note type in sidebar", () => {
		const noteEntries: VaultEntry[] = [
			...mockEntries,
			buildSidebarEntry({
				path: "/vault/note.md",
				filename: "note.md",
				title: "Note",
				isA: "Type",
				status: null,
				owner: null,
				fileSize: 200,
			}),
			buildSidebarEntry({
				path: "/vault/explicit-note.md",
				filename: "explicit-note.md",
				title: "Explicit Note",
				isA: "Note",
				status: null,
				owner: null,
				fileSize: 300,
			}),
			buildSidebarEntry({
				path: "/vault/untyped-note.md",
				filename: "untyped-note.md",
				title: "Untyped Note",
				isA: null,
				status: null,
				owner: null,
				fileSize: 150,
			}),
			buildSidebarEntry({
				path: "/vault/binary-note.pdf",
				filename: "binary-note.pdf",
				title: "Binary Note",
				isA: "Note",
				status: null,
				owner: null,
				fileSize: 150,
				fileKind: "binary",
			}),
		];

		it("shows Notes section when Note entries exist", () => {
			renderSidebar({ entries: noteEntries });
			expect(screen.getByText("Notes")).toBeInTheDocument();
		});

		it("ignores non-markdown Note entries in the Notes section chip", () => {
			renderSidebar({ entries: noteEntries });
			const notesHeader = requireElement(
				screen.getByText("Notes").closest('[class*="group/section"]'),
			);
			expect(notesHeader.textContent).toContain("1");
			expect(notesHeader.textContent).not.toContain("2");
		});

		it("keeps the Notes section count aligned when an entry changes to or from Note", () => {
			const { rerender } = renderSidebar({ entries: noteEntries });
			let notesHeader = requireElement(
				screen.getByText("Notes").closest('[class*="group/section"]'),
			);
			expect(notesHeader.textContent).toContain("1");

			const withoutExplicitNote = noteEntries.map((entry) =>
				entry.path === "/vault/explicit-note.md"
					? { ...entry, isA: null }
					: entry,
			);
			rerender(
				<Sidebar
					entries={withoutExplicitNote}
					selection={defaultSelection}
					onSelect={() => {}}
				/>,
			);
			notesHeader = requireElement(
				screen.getByText("Notes").closest('[class*="group/section"]'),
			);
			expect(notesHeader.textContent).toBe("Notes");

			const withNewExplicitNote = noteEntries.map((entry) =>
				entry.path === "/vault/untyped-note.md"
					? { ...entry, isA: "Note" }
					: entry,
			);
			rerender(
				<Sidebar
					entries={withNewExplicitNote}
					selection={defaultSelection}
					onSelect={() => {}}
				/>,
			);
			notesHeader = requireElement(
				screen.getByText("Notes").closest('[class*="group/section"]'),
			);
			expect(notesHeader.textContent).toContain("2");
		});

		it("does not show Notes section for untyped entries without explicit Note entries", () => {
			const untypedOnly: VaultEntry[] = [
				buildSidebarEntry({
					path: "/vault/plain.md",
					filename: "plain.md",
					title: "Plain Note",
					isA: null,
					status: null,
					owner: null,
					fileSize: 100,
				}),
			];
			renderSidebar({ entries: untypedOnly });
			expect(screen.queryByText("Notes")).not.toBeInTheDocument();
		});
	});

	it("renders exactly one section for a hyphenated custom type like Monday Ideas", () => {
		const entriesWithMondayIdeas: VaultEntry[] = [
			...mockEntries,
			buildSidebarEntry({
				path: "/vault/monday-ideas/standup-bingo.md",
				filename: "standup-bingo.md",
				title: "Standup Bingo",
				isA: "Monday Ideas",
				status: null,
				owner: null,
				fileSize: 310,
				wordCount: 120,
				view: null,
			}),
			buildSidebarEntry({
				path: "/vault/monday-ideas/theme-days.md",
				filename: "theme-days.md",
				title: "Theme Days",
				isA: "Monday Ideas",
				status: null,
				owner: null,
				fileSize: 280,
				wordCount: 95,
				view: null,
			}),
		];
		renderSidebar({ entries: entriesWithMondayIdeas });
		// "Monday Ideas" pluralized → "Monday Ideases" (the pluralizeType function)
		const mondaySections = screen.getAllByText(/Monday Ideas/i);
		expect(mondaySections).toHaveLength(1);
	});

	it("renders Inbox as the first item in the top nav", () => {
		renderSidebar({ entries: [], inboxCount: 5 });
		const topNav = screen.getByTestId("sidebar-top-nav");
		const items = topNav.children;
		expect(items[0].textContent).toContain("Inbox");
		expect(items[1].textContent).toContain("All Notes");
	});

	it("displays inbox count badge", () => {
		renderSidebar({ entries: [], inboxCount: 12 });
		expect(screen.getByText("12")).toBeInTheDocument();
	});

	it("calls onSelect with inbox filter when clicking Inbox", () => {
		const onSelect = vi.fn();
		renderSidebar({ entries: [], onSelect: onSelect, inboxCount: 3 });
		fireEvent.click(screen.getByText("Inbox"));
		expect(onSelect).toHaveBeenCalledWith({ kind: "filter", filter: "inbox" });
	});

	it("hides Inbox when explicit organization is disabled", () => {
		renderSidebar({ entries: [], showInbox: false, inboxCount: 3 });
		expect(screen.queryByText("Inbox")).not.toBeInTheDocument();
		const topNav = screen.getByTestId("sidebar-top-nav");
		expect(topNav.children[0].textContent).toContain("All Notes");
	});

	it("excludes attachments-folder markdown from top-nav note totals", () => {
		const fixtures = [
			{ path: "/vault/note/real-note.md", title: "Real Note", archived: false },
			{
				path: "/vault/attachments/reference.md",
				title: "Attachment Markdown",
				archived: false,
			},
			{
				path: "/vault/attachments/nested/archive.md",
				title: "Attachment Archive",
				archived: true,
			},
			{
				path: "/vault/archive/real-archive.md",
				title: "Real Archive",
				archived: true,
			},
		];
		const entries = fixtures.map((fixture) =>
			buildSidebarEntry({
				...fixture,
				filename: fixture.path.split("/").pop() ?? "",
				isA: "Note",
				status: null,
				owner: null,
			}),
		);
		entries.push(
			buildSidebarEntry({
				path: "/vault/attachments/image.png",
				filename: "image.png",
				title: "image.png",
				isA: null,
				fileKind: "binary",
			}),
		);

		renderSidebar({ entries: entries });

		const topNav = screen.getByTestId("sidebar-top-nav");
		expect(topNav.children[1].textContent).toContain("All Notes1");
		expect(topNav.children[2].textContent).toContain("Archive1");
	});

	it("does not show inline entries — no child items in type sections", () => {
		const entriesWithEmoji: VaultEntry[] = [
			buildSidebarEntry({
				title: "Build App",
				status: null,
				owner: null,
				fileSize: 300,
				icon: "🚀",
				view: null,
				visible: null,
			}),
		];
		renderSidebar({ entries: entriesWithEmoji });
		expect(screen.queryByText("Build App")).not.toBeInTheDocument();
	});
});
