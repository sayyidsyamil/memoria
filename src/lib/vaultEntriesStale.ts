import { useEffect } from "react";

/** Something outside the vault loader added files (a conflict copy from the server): list them again. */
export const VAULT_ENTRIES_STALE_EVENT = "memoria:vault-entries-stale";

export function requestVaultEntriesReload(): void {
	if (typeof window === "undefined") return;
	window.dispatchEvent(new Event(VAULT_ENTRIES_STALE_EVENT));
}

/** Reloads the vault's entries whenever they are reported stale. */
export function useVaultEntriesStaleReload(
	reload: () => Promise<unknown>,
): void {
	useEffect(() => {
		if (typeof window === "undefined") return;
		const handleStale = () => {
			void reload();
		};
		window.addEventListener(VAULT_ENTRIES_STALE_EVENT, handleStale);
		return () =>
			window.removeEventListener(VAULT_ENTRIES_STALE_EVENT, handleStale);
	}, [reload]);
}
