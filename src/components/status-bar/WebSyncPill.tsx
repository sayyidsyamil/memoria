import { useSyncExternalStore } from "react";
import type { CollabStatus } from "../../../packages/collab-client/src/collabProvider";
import {
	useCollabStatus,
	useConflictCopy,
} from "../../hooks/useCollabSyncState";
import {
	type ActiveCollabDocument,
	getActiveCollabDocument,
	subscribeActiveCollabDocument,
} from "../../lib/activeCollabDocument";
import { type AppLocale, translate } from "../../lib/i18n";
import { SyncPill } from "../SyncPill";
import { ConflictCopyNotice } from "./ConflictCopyNotice";
import {
	isSyncPillReadOnly,
	resolveSyncPillState,
	syncPillDescription,
	syncPillLabel,
} from "./syncPillState";

interface WebSyncPillProps {
	isOffline: boolean;
	isReloading: boolean;
	locale: AppLocale;
}

function useActiveCollabDocument(): ActiveCollabDocument {
	return useSyncExternalStore(
		subscribeActiveCollabDocument,
		getActiveCollabDocument,
	);
}

/** The opened document's provider and Y.Doc: none while it is still being opened. */
function bindingsOf(active: ActiveCollabDocument) {
	if (active === null || active === "opening")
		return { provider: null, doc: null };
	return { provider: active.provider, doc: active.doc };
}

function collabOf(
	active: ActiveCollabDocument,
	status: CollabStatus | null,
): CollabStatus | "opening" | null {
	return active === "opening" ? "opening" : status;
}

/** The web status bar's sync state: the active note's live document and the vault's loads. */
export function WebSyncPill({
	isOffline,
	isReloading,
	locale,
}: WebSyncPillProps) {
	const active = useActiveCollabDocument();
	const { provider, doc } = bindingsOf(active);
	const status = useCollabStatus(provider);
	const conflictCopy = useConflictCopy(doc);
	const state = resolveSyncPillState({
		collab: collabOf(active, status),
		conflict: conflictCopy !== undefined,
		offline: isOffline,
		reloading: isReloading,
	});
	const description = syncPillDescription(state, isOffline);
	return (
		<>
			<SyncPill
				state={state}
				label={translate(locale, syncPillLabel(state, isOffline))}
				readOnly={isSyncPillReadOnly(state, isOffline)}
				description={translate(locale, description, {
					file: String(conflictCopy),
				})}
				testId="status-sync-pill"
			/>
			<ConflictCopyNotice conflictCopy={conflictCopy} locale={locale} />
		</>
	);
}
