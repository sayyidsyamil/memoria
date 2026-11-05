import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type {
	CollabProvider,
	CollabStatus,
} from "../../packages/collab-client/src/collabProvider";
import { DOC_META, DOC_META_MAP } from "../../packages/protocol/src/index";
import { useCollabStatus, useConflictCopy } from "./useCollabSyncState";

function fakeProvider(initial: CollabStatus) {
	const listeners = new Set<(status: CollabStatus) => void>();
	const provider = {
		status: initial,
		onStatus(listener: (status: CollabStatus) => void) {
			listeners.add(listener);
			listener(provider.status);
			return () => listeners.delete(listener);
		},
	};
	const set = (status: CollabStatus) => {
		provider.status = status;
		for (const listener of listeners) listener(status);
	};
	return { provider: provider as unknown as CollabProvider, set };
}

describe("useCollabStatus", () => {
	it("follows the provider's status", () => {
		const { provider, set } = fakeProvider("connecting");
		const { result } = renderHook(() => useCollabStatus(provider));
		expect(result.current).toBe("connecting");

		act(() => set("synced"));
		expect(result.current).toBe("synced");
	});

	it("is null without a provider", () => {
		const { result } = renderHook(() => useCollabStatus(null));
		expect(result.current).toBeNull();
	});
});

describe("useConflictCopy", () => {
	it("reports the conflict copy the server records on the document", () => {
		const doc = new Y.Doc();
		const { result } = renderHook(() => useConflictCopy(doc));
		expect(result.current).toBeUndefined();

		act(() =>
			doc
				.getMap<string>(DOC_META_MAP)
				.set(DOC_META.conflictCopy, "note (conflict).md"),
		);
		expect(result.current).toBe("note (conflict).md");
	});

	it("is undefined without a document", () => {
		const { result } = renderHook(() => useConflictCopy(null));
		expect(result.current).toBeUndefined();
	});
});
