import { invoke } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri, mockInvoke } from "../mock-tauri";
import type { VaultEntry } from "../types";
import { clearNoteContentCache } from "./noteContentCache";
import { type NoteActionsConfig, useNoteActions } from "./useNoteActions";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../mock-tauri", () => ({
	isTauri: vi.fn(() => false),
	addMockEntry: vi.fn(),
	updateMockContent: vi.fn(),
	trackMockChange: vi.fn(),
	mockInvoke: vi.fn().mockResolvedValue(""),
}));

const makeEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
	path: "/Users/luca/Laputa/test.md",
	filename: "test.md",
	title: "Test Note",
	isA: "Note",
	aliases: [],
	belongsTo: [],
	relatedTo: [],
	status: "Active",
	archived: false,
	modifiedAt: 1700000000,
	createdAt: 1700000000,
	fileSize: 100,
	snippet: "",
	wordCount: 0,
	relationships: {},
	icon: null,
	color: null,
	order: null,
	outgoingLinks: [],
	template: null,
	sort: null,
	sidebarLabel: null,
	view: null,
	visible: null,
	properties: {},
	organized: false,
	favorite: false,
	favoriteIndex: null,
	listPropertiesDisplay: [],
	hasH1: false,
	...overrides,
});

const makeWorkspace = (
	path: string,
	alias: string,
): NonNullable<VaultEntry["workspace"]> => ({
	id: alias,
	label: alias,
	alias,
	path,
	shortLabel: alias.slice(0, 2).toUpperCase(),
	color: null,
	icon: null,
	mounted: true,
	available: true,
	defaultForNewNotes: false,
});

describe("useNoteActions rename behavior", () => {
	const addEntry = vi.fn();
	const removeEntry = vi.fn();
	const updateEntry = vi.fn();
	const setToastMessage = vi.fn();
	const makeConfig = (entries: VaultEntry[] = []): NoteActionsConfig => ({
		addEntry,
		removeEntry,
		entries,
		setToastMessage,
		updateEntry,
		vaultPath: "/test/vault",
	});

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(invoke).mockReset();
		vi.mocked(isTauri).mockReturnValue(false);
		clearNoteContentCache();
		vi.useRealTimers();
	});

	function savedNoteContentPaths() {
		return vi.mocked(mockInvoke).mock.calls.flatMap(([cmd, args]) => {
			if (cmd !== "save_note_content") return [];
			return hasStringPath(args) ? [args.path] : [];
		});
	}

	function hasStringPath(value: unknown): value is { path: string } {
		if (typeof value !== "object") return false;
		if (value === null) return false;
		if (!("path" in value)) return false;
		return typeof value.path === "string";
	}
	describe("rename note updates wikilinks", () => {
		it("handleRenameNote passes entry title as old_title to rename_note", async () => {
			const entry = makeEntry({
				path: "/test/vault/weekly-review.md",
				filename: "weekly-review.md",
				title: "Weekly Review",
			});
			const replaceEntry = vi.fn();
			const config = makeConfig([entry]);
			config.replaceEntry = replaceEntry;

			vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
				if (cmd === "rename_note")
					return { new_path: "/test/vault/sprint-retro.md", updated_files: 2 };
				if (cmd === "get_note_content")
					return "---\nIs A: Note\n---\n# Sprint Retro\n";
				return "";
			});

			const { result } = renderHook(() => useNoteActions(config));

			await act(async () => {
				await result.current.handleRenameNote(
					"/test/vault/weekly-review.md",
					"Sprint Retro",
					"/test/vault",
					replaceEntry,
				);
			});

			expect(mockInvoke).toHaveBeenCalledWith(
				"rename_note",
				expect.objectContaining({
					vault_path: "/test/vault",
					old_path: "/test/vault/weekly-review.md",
					new_title: "Sprint Retro",
					old_title: "Weekly Review",
				}),
			);
			expect(setToastMessage).toHaveBeenCalledWith("Updated 2 notes");
		});

		it("handleRenameNote passes null old_title when entry not found", async () => {
			const config = makeConfig([]);

			vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
				if (cmd === "rename_note")
					return { new_path: "/test/vault/new.md", updated_files: 0 };
				if (cmd === "get_note_content") return "# New\n";
				return "";
			});

			const { result } = renderHook(() => useNoteActions(config));

			await act(async () => {
				await result.current.handleRenameNote(
					"/test/vault/old.md",
					"New",
					"/test/vault",
					vi.fn(),
				);
			});

			expect(mockInvoke).toHaveBeenCalledWith(
				"rename_note",
				expect.objectContaining({
					old_title: null,
				}),
			);
		});

		it("exposes the workspace move handler from composed note actions", async () => {
			const sourceWorkspace = makeWorkspace("/test/vault", "personal");
			const destinationWorkspace = makeWorkspace("/team/vault", "team");
			const entry = makeEntry({
				path: "/test/vault/project.md",
				filename: "project.md",
				title: "Project",
				workspace: sourceWorkspace,
			});
			const replaceEntry = vi.fn();
			const config = makeConfig([entry]);

			vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
				if (cmd === "move_note_to_workspace") {
					return {
						new_path: "/team/vault/project.md",
						updated_files: 0,
						failed_updates: 0,
					};
				}
				if (cmd === "get_note_content") return "# Project\n";
				return "";
			});

			const { result } = renderHook(() => useNoteActions(config));

			await act(async () => {
				await result.current.handleMoveNoteToWorkspace(
					"/test/vault/project.md",
					destinationWorkspace,
					"/test/vault",
					replaceEntry,
				);
			});

			expect(mockInvoke).toHaveBeenCalledWith(
				"move_note_to_workspace",
				expect.objectContaining({
					source_vault_path: "/test/vault",
					destination_vault_path: "/team/vault",
					old_path: "/test/vault/project.md",
				}),
			);
			expect(replaceEntry).toHaveBeenCalledWith(
				"/test/vault/project.md",
				expect.objectContaining({
					path: "/team/vault/project.md",
					workspace: destinationWorkspace,
				}),
				"# Project\n",
			);
		});

		it("routes stale frontmatter saves to a note moved between workspaces", async () => {
			const sourcePath = "/test/vault/project.md";
			const destinationPath = "/team/vault/project.md";
			const sourceWorkspace = makeWorkspace("/test/vault", "personal");
			const destinationWorkspace = makeWorkspace("/team/vault", "team");
			const entry = makeEntry({
				path: sourcePath,
				filename: "project.md",
				title: "Project",
				workspace: sourceWorkspace,
			});
			const replaceEntry = vi.fn();
			const onPathRenamed = vi.fn();
			const config = makeConfig([entry]);
			config.onPathRenamed = onPathRenamed;

			vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
				if (cmd === "move_note_to_workspace") {
					return {
						new_path: destinationPath,
						updated_files: 0,
						failed_updates: 0,
					};
				}
				if (cmd === "get_note_content") return "# Project\n";
				if (cmd === "save_note_content") return undefined;
				return "";
			});

			const { result } = renderHook(() => useNoteActions(config));

			await act(async () => {
				await result.current.handleMoveNoteToWorkspace(
					sourcePath,
					destinationWorkspace,
					sourceWorkspace.path,
					replaceEntry,
				);
				await result.current.handleUpdateFrontmatter(
					sourcePath,
					"status",
					"Done",
				);
			});

			const savePaths = savedNoteContentPaths();

			expect(onPathRenamed).toHaveBeenCalledWith(sourcePath, destinationPath);
			expect(savePaths).toContain(destinationPath);
			expect(savePaths).not.toContain(sourcePath);
			expect(updateEntry).toHaveBeenCalledWith(
				destinationPath,
				expect.objectContaining({ status: "Done" }),
			);
		});

		it("handleUpdateFrontmatter triggers rename when title key is changed", async () => {
			const entry = makeEntry({
				path: "/test/vault/old-name.md",
				filename: "old-name.md",
				title: "Old Name",
			});
			const onPathRenamed = vi.fn();
			const replaceEntry = vi.fn();
			const config = makeConfig([entry]);
			config.onPathRenamed = onPathRenamed;
			config.replaceEntry = replaceEntry;

			vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
				if (cmd === "rename_note")
					return { new_path: "/test/vault/new-name.md", updated_files: 1 };
				if (cmd === "get_note_content")
					return "---\ntitle: New Name\n---\n# New Name\n";
				return "";
			});

			const { result } = renderHook(() => useNoteActions(config));

			// Open a tab for the entry so the rename can find it via tabsRef
			await act(async () => {
				result.current.handleSelectNote(entry);
			});

			await act(async () => {
				await result.current.handleUpdateFrontmatter(
					"/test/vault/old-name.md",
					"title",
					"New Name",
				);
			});

			expect(mockInvoke).toHaveBeenCalledWith(
				"rename_note",
				expect.objectContaining({
					old_path: "/test/vault/old-name.md",
					new_title: "New Name",
					old_title: "Old Name",
				}),
			);
			expect(replaceEntry).toHaveBeenCalledWith(
				"/test/vault/old-name.md",
				expect.objectContaining({
					path: "/test/vault/new-name.md",
					title: "New Name",
				}),
			);
			expect(onPathRenamed).toHaveBeenCalledWith(
				"/test/vault/old-name.md",
				"/test/vault/new-name.md",
			);
		});

		it("routes undoable frontmatter changes to the renamed note path", async () => {
			const oldPath = "/test/vault/old-name.md";
			const newPath = "/test/vault/new-name.md";
			const entry = makeEntry({
				path: oldPath,
				filename: "old-name.md",
				title: "Old Name",
				status: "Active",
			});
			const config = makeConfig([entry]);
			config.onPathRenamed = vi.fn();
			const replaceEntry = vi.fn();
			config.replaceEntry = replaceEntry;

			vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
				if (cmd === "rename_note")
					return { new_path: newPath, updated_files: 1 };
				if (cmd === "get_note_content")
					return "---\ntitle: New Name\nstatus: Done\n---\n# New Name\n";
				if (cmd === "save_note_content") return undefined;
				return "";
			});

			const { result } = renderHook(() => useNoteActions(config));

			await act(async () => {
				result.current.handleSelectNote(entry);
			});
			await act(async () => {
				await result.current.handleUpdateFrontmatter(oldPath, "status", "Done");
			});
			await act(async () => {
				await result.current.handleRenameNote(
					oldPath,
					"New Name",
					"/test/vault",
					replaceEntry,
				);
			});
			vi.mocked(mockInvoke).mockClear();

			await act(async () => {
				await result.current.handleUndo();
			});

			const savePathsAfterUndo = savedNoteContentPaths();

			expect(savePathsAfterUndo).toContain(newPath);
			expect(savePathsAfterUndo).not.toContain(oldPath);
			expect(updateEntry).toHaveBeenCalledWith(
				newPath,
				expect.objectContaining({ status: "Active" }),
			);

			vi.mocked(mockInvoke).mockClear();
			vi.mocked(updateEntry).mockClear();

			await act(async () => {
				await result.current.handleRedo();
			});

			const savePathsAfterRedo = savedNoteContentPaths();

			expect(savePathsAfterRedo).toContain(newPath);
			expect(savePathsAfterRedo).not.toContain(oldPath);
			expect(updateEntry).toHaveBeenCalledWith(
				newPath,
				expect.objectContaining({ status: "Done" }),
			);
		});

		it("handleUpdateFrontmatter does not trigger rename for non-title keys", async () => {
			const config = makeConfig();
			vi.mocked(mockInvoke).mockResolvedValue("");

			const { result } = renderHook(() => useNoteActions(config));

			await act(async () => {
				await result.current.handleUpdateFrontmatter(
					"/vault/note.md",
					"status",
					"Done",
				);
			});

			expect(mockInvoke).not.toHaveBeenCalledWith(
				"rename_note",
				expect.anything(),
			);
		});
	});
});
