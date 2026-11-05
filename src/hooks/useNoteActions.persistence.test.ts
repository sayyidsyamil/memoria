import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NoteActionsConfig, useNoteActions } from "./useNoteActions";

const mockFiles = vi.hoisted(() => ({
	read: vi.fn().mockResolvedValue({ content: "---\nstatus: Active\n---\n" }),
	write: vi.fn().mockResolvedValue({ status: "written", revision: "next" }),
}));

vi.mock("../lib/vaultBackend", () => ({
	createVaultBackend: () => ({ files: mockFiles }),
	hasRemoteVault: () => false,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../mock-tauri", () => ({
	isTauri: vi.fn(() => false),
	addMockEntry: vi.fn(),
	updateMockContent: vi.fn(),
	trackMockChange: vi.fn(),
	mockInvoke: vi.fn().mockResolvedValue(""),
}));

function makeConfig(onFrontmatterPersisted: () => void): NoteActionsConfig {
	return {
		addEntry: vi.fn(),
		removeEntry: vi.fn(),
		entries: [],
		setToastMessage: vi.fn(),
		updateEntry: vi.fn(),
		vaultPath: "/test/vault",
		onFrontmatterPersisted,
	};
}

describe("useNoteActions frontmatter persistence", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each(["update", "delete"] as const)(
		"notifies after a frontmatter %s completes",
		async (operation) => {
			const onFrontmatterPersisted = vi.fn();
			const { result } = renderHook(() =>
				useNoteActions(makeConfig(onFrontmatterPersisted)),
			);

			await act(async () => {
				if (operation === "update") {
					await result.current.handleUpdateFrontmatter(
						"/vault/note.md",
						"_list_properties_display",
						["Owner", "Status"],
					);
				} else {
					await result.current.handleDeleteProperty("/vault/note.md", "status");
				}
			});

			expect(onFrontmatterPersisted).toHaveBeenCalledTimes(1);
		},
	);

	it.each(["update", "delete"] as const)(
		"flushes pending raw content before a frontmatter %s",
		async (operation) => {
			const flushBeforeNoteMutation = vi.fn().mockResolvedValue(undefined);
			const { result } = renderHook(() =>
				useNoteActions({
					...makeConfig(vi.fn()),
					flushBeforeNoteMutation,
				}),
			);

			await act(async () => {
				if (operation === "update") {
					await result.current.handleUpdateFrontmatter(
						"/vault/note.md",
						"status",
						"Done",
					);
				} else {
					await result.current.handleDeleteProperty("/vault/note.md", "status");
				}
			});

			expect(flushBeforeNoteMutation).toHaveBeenCalledWith("/vault/note.md");
		},
	);
});
