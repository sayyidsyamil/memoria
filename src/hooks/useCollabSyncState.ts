import { useCallback, useSyncExternalStore } from "react";
import type * as Y from "yjs";
import type {
	CollabProvider,
	CollabStatus,
} from "../../packages/collab-client/src/collabProvider";
import { DOC_META, DOC_META_MAP } from "../../packages/protocol/src/index";

/** The provider's connection and sync state, or null without a provider. */
export function useCollabStatus(
	provider: CollabProvider | null,
): CollabStatus | null {
	const subscribe = useCallback(
		(notify: () => void) => provider?.onStatus(notify) ?? (() => {}),
		[provider],
	);
	return useSyncExternalStore(subscribe, () => provider?.status ?? null);
}

/** Where the server kept the edits it could not merge with the file, if it had to. */
export function useConflictCopy(doc: Y.Doc | null): string | undefined {
	const subscribe = useCallback(
		(notify: () => void) => {
			const meta = doc?.getMap<string>(DOC_META_MAP);
			meta?.observe(notify);
			return () => meta?.unobserve(notify);
		},
		[doc],
	);
	return useSyncExternalStore(subscribe, () =>
		doc?.getMap<string>(DOC_META_MAP).get(DOC_META.conflictCopy),
	);
}
