import type { CollabStatus } from "../../../packages/collab-client/src/collabProvider";
import type { TranslationKey } from "../../lib/i18n";
import { resolveBrowserBackendKind } from "../../lib/platformCapabilities";
import { isTauri } from "../../mock-tauri";

/** What the web status bar's sync pill shows, in place of the desktop's git controls. */
export type SyncPillState =
	| "connecting"
	| "syncing"
	| "synced"
	| "offline"
	| "conflict";

export interface SyncPillInputs {
	/** The active note's live document: its provider state, `opening` while it opens, or null. */
	collab: CollabStatus | "opening" | null;
	/** The server kept edits it could not merge as a conflict copy. */
	conflict: boolean;
	/** The browser has no network. */
	offline: boolean;
	/** The vault's notes are being loaded or reloaded in the background. */
	reloading: boolean;
}

const CONNECTING: ReadonlySet<SyncPillInputs["collab"]> = new Set([
	"opening",
	"connecting",
	"closed",
]);

export function resolveSyncPillState({
	collab,
	conflict,
	offline,
	reloading,
}: SyncPillInputs): SyncPillState {
	if (conflict) return "conflict";
	if (offline || collab === "offline") return "offline";
	if (CONNECTING.has(collab)) return "connecting";
	if (collab === "syncing" || reloading) return "syncing";
	return "synced";
}

/** The pill's icon spins in these states: the only reload and sync indicator on the web. */
export function isSyncPillBusy(state: SyncPillState): boolean {
	return state === "connecting" || state === "syncing";
}

const SYNC_PILL_LABELS = new Map<SyncPillState, TranslationKey>([
	["connecting", "collab.status.connecting"],
	["syncing", "collab.status.syncing"],
	["synced", "status.sync.synced"],
	["offline", "status.offline.label"],
	["conflict", "status.sync.conflict"],
]);

function stateLabel(state: SyncPillState): TranslationKey {
	return SYNC_PILL_LABELS.get(state) ?? "status.sync.synced";
}

/** Without a network the web vault is read-only, and the pill says so. */
export function isSyncPillReadOnly(
	state: SyncPillState,
	browserOffline: boolean,
): boolean {
	return state === "offline" && browserOffline;
}

export function syncPillLabel(
	state: SyncPillState,
	browserOffline: boolean,
): TranslationKey {
	return isSyncPillReadOnly(state, browserOffline)
		? "status.offline.readOnlyLabel"
		: stateLabel(state);
}

/** The description behind the pill's label; offline depends on what is offline. */
export function syncPillDescription(
	state: SyncPillState,
	browserOffline: boolean,
): TranslationKey {
	if (state === "offline")
		return browserOffline
			? "status.offline.readOnlyTitle"
			: "collab.status.offline";
	if (state === "conflict") return "collab.conflictCopy";
	if (state === "synced") return "collab.status.synced";
	return stateLabel(state);
}

/** The browser build talking to a Memoria server: the web status bar shows the sync pill. */
export function isRemoteBrowserShell(): boolean {
	return !isTauri() && resolveBrowserBackendKind() === "remote";
}
