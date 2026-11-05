import { useEffect } from "react";
import type { Awareness } from "y-protocols/awareness";
import type { RemoteBindings } from "../../packages/collab-client/src/remoteVaultBackend";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { localPresenceUser } from "../lib/presenceIdentity";
import type {
	VaultCollabDoc,
	VaultCollabUser,
} from "../lib/vaultBackend/types";

type PresenceAwareness = Pick<
	Awareness,
	"getLocalState" | "setLocalState" | "setLocalStateField"
>;

/**
 * Shows this window in the note, or takes it out. Offline it withdraws: the others stop
 * seeing it at once when the withdrawal still gets through, and once its renewals stop
 * otherwise. Back online it announces itself again; the caret follows with the next move.
 */
export function announcePresence(
	awareness: PresenceAwareness,
	user: VaultCollabUser,
	online: boolean,
): void {
	const present = awareness.getLocalState() !== null;
	if (!online) {
		if (present) awareness.setLocalState(null);
		return;
	}
	if (present) awareness.setLocalStateField("user", user);
	else awareness.setLocalState({ user });
}

/**
 * Announces this window in the open live document as soon as it opens, before the editor
 * binds to it, so the others see who is there while the note is still loading.
 */
export function useLocalPresence(
	doc: VaultCollabDoc<RemoteBindings> | null,
): void {
	const { isOffline } = useNetworkStatus();
	useEffect(() => {
		if (!doc) return;
		announcePresence(
			doc.awareness,
			localPresenceUser(doc.doc.clientID),
			!isOffline,
		);
	}, [doc, isOffline]);
}
