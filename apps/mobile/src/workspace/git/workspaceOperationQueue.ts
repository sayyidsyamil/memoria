const pending = new Map<string, Promise<unknown>>();
const linkedSyncs = new Set<string>();

/** Serializes editor writes and Git mutations that share a working copy. */
export async function withWorkspaceOperation<T>(
	root: string,
	operation: () => Promise<T>,
): Promise<T> {
	const previous = pending.get(root) ?? Promise.resolve();
	const current = previous.catch(() => undefined).then(operation);
	pending.set(root, current);
	try {
		return await current;
	} finally {
		if (pending.get(root) === current) pending.delete(root);
	}
}

/** Allows atomic managed-copy note reads through a linked-folder sync. */
export function withWorkspaceRead<T>(
	root: string,
	read: (duringLinkedSync: boolean) => Promise<T>,
) {
	if (linkedSyncs.has(root)) return read(true);
	return withWorkspaceOperation(root, () => read(false));
}

/** Mark only the native linked-folder merge window; callers already hold the root queue. */
export async function withLinkedWorkspaceSync<T>(
	root: string,
	sync: () => Promise<T>,
) {
	linkedSyncs.add(root);
	try {
		return await sync();
	} finally {
		linkedSyncs.delete(root);
	}
}
