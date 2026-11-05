import type { RemoteBindings } from "../../packages/collab-client/src/remoteVaultBackend";
import type { VaultCollabDoc } from "./vaultBackend/types";

/**
 * The live document of the note the web editor shows, for the surfaces outside the editor
 * that report its sync state (the status bar's sync pill). `opening` while the document is
 * being opened, null when no note is bound to one.
 */
export type ActiveCollabDocument =
	| VaultCollabDoc<RemoteBindings>
	| "opening"
	| null;

let active: ActiveCollabDocument = null;
const listeners = new Set<() => void>();

function notify(): void {
	for (const listener of listeners) listener();
}

export function getActiveCollabDocument(): ActiveCollabDocument {
	return active;
}

export function subscribeActiveCollabDocument(
	listener: () => void,
): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Makes `next` the active document. Returns how to withdraw it, which leaves a newer one alone. */
export function publishActiveCollabDocument(
	next: ActiveCollabDocument,
): () => void {
	active = next;
	notify();
	return () => {
		if (active !== next) return;
		active = null;
		notify();
	};
}
