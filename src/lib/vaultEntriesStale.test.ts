import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	requestVaultEntriesReload,
	useVaultEntriesStaleReload,
} from "./vaultEntriesStale";

describe("useVaultEntriesStaleReload", () => {
	it("reloads the entries each time they are reported stale, until unmounted", () => {
		const reload = vi.fn().mockResolvedValue([]);
		const { unmount } = renderHook(() => useVaultEntriesStaleReload(reload));

		requestVaultEntriesReload();
		requestVaultEntriesReload();
		expect(reload).toHaveBeenCalledTimes(2);

		unmount();
		requestVaultEntriesReload();
		expect(reload).toHaveBeenCalledTimes(2);
	});
});
