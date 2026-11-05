import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteBindings } from "../../packages/collab-client/src/remoteVaultBackend";
import type { VaultBackend, VaultCollabDoc } from "../lib/vaultBackend/types";
import { getActiveCollabDocument } from "../lib/activeCollabDocument";
import * as vaultAccess from "../lib/sharing/vaultAccess";
import { useCollabDocument } from "./useCollabDocument";

describe("useCollabDocument", () => {
	let mockVaultBackend: VaultBackend;
	let mockDoc: VaultCollabDoc<RemoteBindings>;

	beforeEach(() => {
		mockDoc = {
			path: "test.md",
			doc: {} as RemoteBindings["doc"],
			fragment: {} as RemoteBindings["fragment"],
			provider: {} as RemoteBindings["provider"],
			awareness: {} as RemoteBindings["awareness"],
			synced: Promise.resolve(),
			close: vi.fn(),
		};

		mockVaultBackend = {
			kind: "remote",
			interfaceVersion: 1,
			capabilities: {
				collaboration: true,
				atomicRevisions: true,
				attachments: false,
			},
			files: {} as VaultBackend["files"],
			chrome: {} as VaultBackend["chrome"],
			collab: {
				openDoc: vi.fn().mockResolvedValue(mockDoc),
			},
		};
	});

	function renderCollab(
		overrides: Partial<Parameters<typeof useCollabDocument>[0]> = {},
	) {
		const options = {
			vaultBackend: mockVaultBackend,
			path: "test.md",
			enabled: true,
			...overrides,
		};
		return renderHook(() => useCollabDocument(options));
	}

	it.each([
		["not enabled", { enabled: false }],
		["no path provided", { path: null }],
	])("returns null when %s", (_reason, overrides) => {
		const { result } = renderCollab(overrides);

		expect(result.current.doc).toBeNull();
		expect(result.current.synced).toBe(false);
		expect(mockVaultBackend.collab?.openDoc).not.toHaveBeenCalled();
	});

	it("returns null when no collab support", () => {
		const noCollabBackend = { ...mockVaultBackend, collab: null };

		const { result } = renderCollab({ vaultBackend: noCollabBackend });

		expect(result.current.doc).toBeNull();
		expect(result.current.synced).toBe(false);
	});


	it("opens document and waits for sync", async () => {
		const { result } = renderCollab();

		await waitFor(() => {
			expect(result.current.doc).toBe(mockDoc);
			expect(result.current.synced).toBe(true);
			expect(result.current.error).toBeNull();
		});

		expect(mockVaultBackend.collab?.openDoc).toHaveBeenCalledWith("test.md", { readOnly: false });
	});

	it("closes document on unmount", async () => {
		const { result, unmount } = renderHook(() =>
			useCollabDocument({
				vaultBackend: mockVaultBackend,
				path: "test.md",
				enabled: true,
			}),
		);

		await waitFor(() => {
			expect(result.current.doc).toBe(mockDoc);
		});

		unmount();

		expect(mockDoc.close).toHaveBeenCalled();
	});

	it("closes old document when path changes", async () => {
		const newMockDoc = { ...mockDoc, path: "new.md", close: vi.fn() };
		const openDoc = vi
			.fn()
			.mockResolvedValueOnce(mockDoc)
			.mockResolvedValueOnce(newMockDoc);

		const backend = { ...mockVaultBackend, collab: { openDoc } };

		const { result, rerender } = renderHook(
			({ path }) =>
				useCollabDocument({ vaultBackend: backend, path, enabled: true }),
			{ initialProps: { path: "test.md" } },
		);

		await waitFor(() => {
			expect(result.current.doc).toBe(mockDoc);
		});

		rerender({ path: "new.md" });

		await waitFor(() => {
			expect(mockDoc.close).toHaveBeenCalled();
			expect(result.current.doc).toBe(newMockDoc);
		});
	});

	it("reports no document for a new path until that path's document is open", async () => {
		const newDoc = {
			...mockDoc,
			path: "new.md",
			synced: new Promise<void>(() => {}),
			close: vi.fn(),
		};
		let openNew: (doc: typeof newDoc) => void = () => {};
		const openDoc = vi
			.fn()
			.mockResolvedValueOnce(mockDoc)
			.mockReturnValueOnce(
				new Promise((resolve) => {
					openNew = resolve;
				}),
			);
		const backend = { ...mockVaultBackend, collab: { openDoc } };

		const { result, rerender } = renderHook(
			({ path }) =>
				useCollabDocument({ vaultBackend: backend, path, enabled: true }),
			{ initialProps: { path: "test.md" } },
		);
		await waitFor(() => expect(result.current.synced).toBe(true));

		rerender({ path: "new.md" });
		expect(result.current).toEqual({ doc: null, synced: false, error: null });

		openNew(newDoc);
		await waitFor(() => expect(result.current.doc).toBe(newDoc));
		expect(result.current.synced).toBe(false);
	});

	it("closes a document that opens after the hook has left", async () => {
		let openLate: (doc: typeof mockDoc) => void = () => {};
		const openDoc = vi.fn().mockReturnValue(
			new Promise((resolve) => {
				openLate = resolve;
			}),
		);
		const backend = { ...mockVaultBackend, collab: { openDoc } };

		const { unmount } = renderHook(() =>
			useCollabDocument({
				vaultBackend: backend,
				path: "test.md",
				enabled: true,
			}),
		);
		unmount();
		openLate(mockDoc);

		await waitFor(() => expect(mockDoc.close).toHaveBeenCalled());
	});

	it("handles sync errors gracefully", async () => {
		const syncError = new Error("Sync failed");
		const failingDoc = { ...mockDoc, synced: Promise.reject(syncError) };
		const openDoc = vi.fn().mockResolvedValue(failingDoc);
		const backend = { ...mockVaultBackend, collab: { openDoc } };

		const { result } = renderCollab({ vaultBackend: backend });

		await waitFor(() => {
			expect(result.current.error).toEqual(syncError);
			expect(result.current.synced).toBe(false);
		});
	});

	it.each([
		["an Error", new Error("Failed to open"), "Failed to open"],
		["a non-Error, as an Error", "offline", "offline"],
	])("reports an openDoc failure that is %s", async (_kind, failure, message) => {
		const openDoc = vi.fn().mockRejectedValue(failure);
		const backend = { ...mockVaultBackend, collab: { openDoc } };

		const { result } = renderCollab({ vaultBackend: backend });

		await waitFor(() => {
			expect(result.current.error).toBeInstanceOf(Error);
			expect(result.current.error?.message).toBe(message);
			expect(result.current.doc).toBeNull();
		});
	});

	it("keeps the open document when its note is renamed from this page", async () => {
		const { result, rerender } = renderHook(
			({ path }) =>
				useCollabDocument({ vaultBackend: mockVaultBackend, path, enabled: true }),
			{ initialProps: { path: "test.md" } },
		);
		await waitFor(() => expect(result.current.synced).toBe(true));

		// The backend moves an open document with its file when this page renames it.
		mockDoc.path = "big-idea.md";
		rerender({ path: "big-idea.md" });

		expect(result.current).toMatchObject({ doc: mockDoc, synced: true });
		await waitFor(() => expect(result.current.doc).toBe(mockDoc));
		expect(mockVaultBackend.collab?.openDoc).toHaveBeenCalledTimes(1);
		expect(mockDoc.close).not.toHaveBeenCalled();
	});

	it("closes the document for a different note, and on unmount", async () => {
		const { result, rerender, unmount } = renderHook(
			({ path }) =>
				useCollabDocument({ vaultBackend: mockVaultBackend, path, enabled: true }),
			{ initialProps: { path: "test.md" } },
		);
		await waitFor(() => expect(result.current.synced).toBe(true));

		rerender({ path: "other.md" });
		expect(result.current.doc).toBeNull();
		expect(mockDoc.close).toHaveBeenCalledTimes(1);
		expect(mockVaultBackend.collab?.openDoc).toHaveBeenLastCalledWith("other.md", {
			readOnly: false,
		});

		unmount();
		await waitFor(() => expect(mockDoc.close).toHaveBeenCalledTimes(2));
	});

	it("publishes the document it holds for the status bar's sync pill", async () => {
		const { result, unmount } = renderCollab();
		expect(getActiveCollabDocument()).toBe("opening");

		await waitFor(() => expect(result.current.doc).toBe(mockDoc));
		expect(getActiveCollabDocument()).toBe(mockDoc);

		unmount();
		expect(getActiveCollabDocument()).toBeNull();
	});

	it("publishes nothing without a note to open", () => {
		renderCollab({ path: null });
		expect(getActiveCollabDocument()).toBeNull();
	});

	it("joins a note shared to view with a read ticket, and reopens it when the role changes (TOL-237)", async () => {
		const { result, rerender } = renderHook(
			({ readOnly }) =>
				useCollabDocument({ vaultBackend: mockVaultBackend, path: "test.md", enabled: true, readOnly }),
			{ initialProps: { readOnly: true } },
		);
		await waitFor(() => expect(result.current.synced).toBe(true));
		expect(mockVaultBackend.collab?.openDoc).toHaveBeenCalledWith("test.md", { readOnly: true });

		rerender({ readOnly: false });
		expect(result.current.doc).toBeNull();
		expect(mockDoc.close).toHaveBeenCalledTimes(1);
		expect(mockVaultBackend.collab?.openDoc).toHaveBeenLastCalledWith("test.md", { readOnly: false });
		await waitFor(() => expect(result.current.synced).toBe(true));
	});

	it("rechecks the access when the server closes the document on its own (TOL-237)", async () => {
		const reportSpy = vi.spyOn(vaultAccess, "reportAccessDenied").mockImplementation(() => {});
		let statusListener: ((status: string) => void) | null = null;
		mockDoc.provider = {
			onStatus: (listener: (status: string) => void) => {
				statusListener = listener;
				return () => {};
			},
		} as unknown as RemoteBindings["provider"];
		const { result, unmount } = renderCollab();
		await waitFor(() => expect(result.current.synced).toBe(true));

		statusListener?.("synced");
		expect(reportSpy).not.toHaveBeenCalled();
		statusListener?.("closed");
		expect(reportSpy).toHaveBeenCalledTimes(1);

		unmount();
		statusListener?.("closed");
		expect(reportSpy).toHaveBeenCalledTimes(1);
		reportSpy.mockRestore();
	});
});
