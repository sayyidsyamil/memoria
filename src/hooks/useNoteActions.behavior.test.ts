import { invoke } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri, mockInvoke } from "../mock-tauri";
import type { VaultEntry } from "../types";
import { clearNoteContentCache } from "./noteContentCache";
import { type NoteActionsConfig, useNoteActions } from "./useNoteActions";
import { RAPID_CREATE_NOTE_SETTLE_MS } from "./useNoteCreation";

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

describe("useNoteActions behavior", () => {
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

	async function flushAsyncWork() {
		await Promise.resolve();
		await Promise.resolve();
	}
	describe("optimistic error recovery (Tauri mode)", () => {
		beforeEach(() => {
			vi.mocked(isTauri).mockReturnValue(true);
		});

		it.each([
			["handleCreateNote", "Failing Note", "Note", "failing-note.md"],
			["handleCreateType", "Recipe", "Type", "recipe.md"],
		])(
			"reverts optimistic creation via %s when disk write fails",
			async (method, title, type, pathFragment) => {
				vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));
				const { result } = renderHook(() => useNoteActions(makeConfig()));

				await act(async () => {
					if (method === "handleCreateNote")
						result.current.handleCreateNote(title, type);
					else result.current.handleCreateType(title);
					await new Promise((r) => setTimeout(r, 0));
				});

				expect(addEntry).toHaveBeenCalledTimes(1);
				expect(removeEntry).toHaveBeenCalledWith(
					expect.stringContaining(pathFragment),
				);
				expect(setToastMessage).toHaveBeenCalledWith(
					type === "Type"
						? "Failed to create type — disk write error"
						: "Failed to create note — disk write error",
				);
			},
		);

		it("does not revert when disk write succeeds", async () => {
			vi.mocked(invoke).mockResolvedValueOnce(undefined);
			const { result } = renderHook(() => useNoteActions(makeConfig()));

			await act(async () => {
				result.current.handleCreateNote("Good Note", "Note");
				await new Promise((r) => setTimeout(r, 0));
			});

			expect(removeEntry).not.toHaveBeenCalled();
			expect(setToastMessage).not.toHaveBeenCalled();
		});

		it("handleCreateNoteImmediate writes each rapid note before opening it", async () => {
			vi.useFakeTimers();
			vi.mocked(invoke).mockResolvedValue(undefined);
			const { result } = renderHook(() => useNoteActions(makeConfig()));

			await act(async () => {
				result.current.handleCreateNoteImmediate();
				result.current.handleCreateNoteImmediate();
				result.current.handleCreateNoteImmediate();
				await flushAsyncWork();
			});
			await act(async () => {
				vi.advanceTimersByTime(RAPID_CREATE_NOTE_SETTLE_MS);
				await flushAsyncWork();
			});
			await act(async () => {
				vi.advanceTimersByTime(RAPID_CREATE_NOTE_SETTLE_MS);
				await flushAsyncWork();
			});

			expect(addEntry).toHaveBeenCalledTimes(3);
			expect(
				vi
					.mocked(invoke)
					.mock.calls.filter(([command]) => command === "create_note_content"),
			).toHaveLength(3);
			expect(removeEntry).not.toHaveBeenCalled();
		});
	});

	describe("type change does not move file", () => {
		it("changing type only updates frontmatter, does not move file", async () => {
			const entry = makeEntry({
				path: "/test/vault/my-note.md",
				filename: "my-note.md",
				title: "My Note",
				isA: "Note",
			});
			const config = makeConfig([entry]);
			vi.mocked(mockInvoke).mockResolvedValue("");

			const { result } = renderHook(() => useNoteActions(config));

			await act(async () => {
				await result.current.handleUpdateFrontmatter(
					"/test/vault/my-note.md",
					"type",
					"Quarter",
				);
			});

			expect(setToastMessage).toHaveBeenCalledWith("Property updated");
		});
	});

	describe("note open is read-only", () => {
		it("does not sync title or reload entry when reopening an identity-matched cached note", async () => {
			vi.mocked(isTauri).mockReturnValue(true);
			const entry = makeEntry({
				path: "/test/vault/qa-test.md",
				filename: "qa-test.md",
				title: "Qa Test",
			});
			vi.mocked(invoke).mockImplementation(async (command) => {
				if (command === "validate_note_content") return true;
				if (command === "get_note_content") return "# Qa Test\n";
				return null;
			});

			const { result } = renderHook(() => useNoteActions(makeConfig([entry])));

			await act(async () => {
				await result.current.handleSelectNote(entry);
			});
			const callCountAfterFirstOpen = vi.mocked(invoke).mock.calls.length;

			const desyncedEntry = { ...entry, title: "Wrong Title Desynced" };
			await act(async () => {
				await result.current.handleSelectNote(desyncedEntry);
			});

			expect(vi.mocked(invoke)).toHaveBeenCalledTimes(callCountAfterFirstOpen);
			expect(vi.mocked(invoke).mock.calls).toEqual([
				["get_note_content", { path: "/test/vault/qa-test.md" }],
			]);
			expect(result.current.tabs[0].entry.title).toBe("Qa Test");
		});
	});
});
