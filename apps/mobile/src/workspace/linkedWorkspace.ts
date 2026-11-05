import { runSavedVaultOperation } from "./git/savedVaultOperation";
import { withLinkedWorkspaceSync } from "./git/workspaceOperationQueue";
import { withSavedWorkspace } from "./git/workspaceWriteQueue";
import {
	type NativeWorkspaceAccessModule,
	optionalNativeWorkspaceAccessModule,
} from "./nativeWorkspaceAccess";
import type { createWorkspaceSyncEditors } from "./workspaceSyncEditors";

export function isWorkspaceLinked(
	root: string | undefined,
	native = optionalNativeWorkspaceAccessModule(),
) {
	if (!root) return false;
	return native?.isWorkspaceLinked?.(root) ?? false;
}

export async function syncLinkedWorkspace(
	root: string,
	native: NativeWorkspaceAccessModule | null = optionalNativeWorkspaceAccessModule(),
) {
	const sync = native?.syncLinkedWorkspace;
	if (!sync) throw new Error("linkedFolderUnavailable");
	try {
		return await withSavedWorkspace(root, () =>
			withLinkedWorkspaceSync(root, () => sync(root)),
		);
	} catch {
		throw new Error("linkedFolderUnavailable");
	}
}

export async function syncLinkedWorkspaceWithEditors(
	root: string,
	editors: ReturnType<typeof createWorkspaceSyncEditors>,
	refresh: (selectedNoteId?: string) => void | Promise<void>,
	native?: NativeWorkspaceAccessModule | null,
) {
	let result: Awaited<ReturnType<typeof syncLinkedWorkspace>> | undefined;
	await runSavedVaultOperation({
		editors,
		run: async () => {
			result = await syncLinkedWorkspace(root, native);
			return result.changed ? undefined : "unchanged";
		},
		refresh,
	});
	if (!result) throw new Error("linkedFolderSyncResultMissing");
	return result;
}
