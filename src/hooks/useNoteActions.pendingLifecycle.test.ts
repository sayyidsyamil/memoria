import { invoke } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "../mock-tauri";
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

describe("useNoteActions pending save lifecycle", () => {
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

	describe("pending save lifecycle", () => {
		it.each([
			["start", "Pending Test", "pending-test.md", "addPendingSave"],
			["completion", "Persist OK", "persist-ok.md", "removePendingSave"],
		])(
			"createAndPersist calls pending-save callback on %s (non-Tauri)",
			async (_phase, title, pathFragment, callbackName) => {
				const addPendingSave = vi.fn();
				const removePendingSave = vi.fn();
				const config = makeConfig();
				config.addPendingSave = addPendingSave;
				config.removePendingSave = removePendingSave;

				const { result } = renderHook(() => useNoteActions(config));

				await act(async () => {
					result.current.handleCreateNote(title, "Note");
					await flushAsyncWork();
				});

				const callback =
					callbackName === "addPendingSave"
						? addPendingSave
						: removePendingSave;
				expect(callback).toHaveBeenCalledWith(
					expect.stringContaining(pathFragment),
				);
			},
		);

		it("createAndPersist calls removePendingSave AND reverts when persist fails (Tauri)", async () => {
			vi.mocked(isTauri).mockReturnValue(true);
			vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));
			const addPendingSave = vi.fn();
			const removePendingSave = vi.fn();
			const config = makeConfig();
			config.addPendingSave = addPendingSave;
			config.removePendingSave = removePendingSave;

			const { result } = renderHook(() => useNoteActions(config));

			await act(async () => {
				result.current.handleCreateNote("Fail Save", "Note");
				await new Promise((r) => setTimeout(r, 0));
			});

			expect(addPendingSave).toHaveBeenCalledWith(
				expect.stringContaining("fail-save.md"),
			);
			expect(removePendingSave).toHaveBeenCalledWith(
				expect.stringContaining("fail-save.md"),
			);
			expect(removeEntry).toHaveBeenCalledWith(
				expect.stringContaining("fail-save.md"),
			);
			expect(setToastMessage).toHaveBeenCalledWith(
				"Failed to create note — disk write error",
			);
		});

		it("handleCreateNoteImmediate creates the backing file before opening the note", async () => {
			vi.mocked(isTauri).mockReturnValue(true);
			vi.mocked(invoke).mockResolvedValueOnce(undefined);
			const addPendingSave = vi.fn();
			const removePendingSave = vi.fn();
			const onNewNotePersisted = vi.fn();
			const config = makeConfig();
			config.addPendingSave = addPendingSave;
			config.removePendingSave = removePendingSave;
			config.onNewNotePersisted = onNewNotePersisted;

			const { result } = renderHook(() => useNoteActions(config));

			await act(async () => {
				result.current.handleCreateNoteImmediate();
				await flushAsyncWork();
			});

			const createdPath = expect.stringMatching(/untitled-note-\d+\.md$/);
			expect(vi.mocked(invoke)).toHaveBeenCalledWith("create_note_content", {
				path: createdPath,
				content: expect.stringContaining("type: Note"),
				vaultPath: "/test/vault",
			});
			expect(addPendingSave).toHaveBeenCalledWith(createdPath);
			expect(removePendingSave).toHaveBeenCalledWith(createdPath);
			expect(onNewNotePersisted).toHaveBeenCalledOnce();
			expect(onNewNotePersisted).toHaveBeenCalledWith(createdPath);
			expect(addEntry).toHaveBeenCalledTimes(1);
			expect(result.current.tabs[0].entry.path).toMatch(
				/untitled-note-\d+\.md$/,
			);
		});

		it("calls onNewNotePersisted after successful disk write (non-Tauri)", async () => {
			const onNewNotePersisted = vi.fn();
			const config = makeConfig();
			config.onNewNotePersisted = onNewNotePersisted;

			const { result } = renderHook(() => useNoteActions(config));

			await act(async () => {
				result.current.handleCreateNote("Persist Callback", "Note");
				await new Promise((r) => setTimeout(r, 0));
			});

			expect(onNewNotePersisted).toHaveBeenCalledTimes(1);
			expect(onNewNotePersisted).toHaveBeenCalledWith(
				expect.stringContaining("persist-callback.md"),
			);
		});

		it("does not call onNewNotePersisted when disk write fails (Tauri)", async () => {
			vi.mocked(isTauri).mockReturnValue(true);
			vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));
			const onNewNotePersisted = vi.fn();
			const config = makeConfig();
			config.onNewNotePersisted = onNewNotePersisted;

			const { result } = renderHook(() => useNoteActions(config));

			await act(async () => {
				result.current.handleCreateNote("Fail Persist", "Note");
				await new Promise((r) => setTimeout(r, 0));
			});

			expect(onNewNotePersisted).not.toHaveBeenCalled();
		});
	});
});
