import { useCallback } from "react";
import type { VaultOption } from "../components/status-bar/types";
import type { VaultEntry } from "../types";
import type { PersistNewNoteRequest, ResolvedEntry } from "./noteCreationCore";
import { addEntryWithMock, persistNewNote } from "./noteCreationCore";
import { useCreateNoteInFolderRequests } from "./noteCreationRequests";

export * from "./noteCreationCore";
export type { ImmediateCreateOptions } from "./noteCreationImmediate";

import { useImmediateCreateQueue } from "./noteCreationImmediate";
import {
	type PersistResolvedOptions,
	useNamedCreationActions,
} from "./noteCreationNamed";

interface PersistCallbacks {
	onStart?: (p: string) => void;
	onEnd?: (p: string) => void;
	onPersisted?: (path: string) => void;
}

/** Persist to disk; track pending state via onStart/onEnd. */
function persistOptimistic(
	request: PersistNewNoteRequest,
	cbs: PersistCallbacks,
): Promise<string> {
	cbs.onStart?.(request.path);
	return persistNewNote(request)
		.then((storedPath) => {
			cbs.onPersisted?.(storedPath);
			return storedPath;
		})
		.finally(() => {
			cbs.onEnd?.(request.path);
		});
}

export interface NoteCreationConfig {
	addEntry: (entry: VaultEntry) => void;
	removeEntry: (path: string) => void;
	entries: VaultEntry[];
	setToastMessage: (msg: string | null) => void;
	vaultPath: string;
	defaultWorkspacePath?: string | null;
	vaults?: readonly VaultOption[];
	addPendingSave?: (path: string) => void;
	removePendingSave?: (path: string) => void;
	trackUnsaved?: (path: string) => void;
	clearUnsaved?: (path: string) => void;
	unsavedPaths?: Set<string>;
	markContentPending?: (path: string, content: string) => void;
	onNewNotePersisted?: (path: string) => void;
	onTypeStateChanged?: () => void | Promise<void>;
}

interface CreationTabDeps {
	openTabWithContent: (entry: VaultEntry, content: string) => void;
}

function usePersistResolvedEntry(
	config: NoteCreationConfig,
	openTabWithContent: CreationTabDeps["openTabWithContent"],
) {
	const {
		addEntry,
		removeEntry,
		addPendingSave,
		removePendingSave,
		onNewNotePersisted,
		onTypeStateChanged,
	} = config;
	const persistResolvedEntry = useCallback(
		async (
			resolved: ResolvedEntry,
			options?: PersistResolvedOptions,
		): Promise<void> => {
			if (options?.openTab !== false)
				openTabWithContent(resolved.entry, resolved.content);
			addEntryWithMock(resolved.entry, resolved.content, addEntry);
			try {
				await persistOptimistic(
					{
						path: resolved.entry.path,
						content: resolved.content,
						vaultPath: resolved.entry.workspace?.path,
					},
					{
						onStart: addPendingSave,
						onEnd: removePendingSave,
						onPersisted: onNewNotePersisted,
					},
				);
				if (resolved.entry.isA === "Type") await onTypeStateChanged?.();
			} catch (error) {
				removeEntry(resolved.entry.path);
				throw error;
			}
		},
		[
			openTabWithContent,
			addEntry,
			addPendingSave,
			removePendingSave,
			onNewNotePersisted,
			onTypeStateChanged,
			removeEntry,
		],
	);
	return persistResolvedEntry;
}

export function useNoteCreation(
	config: NoteCreationConfig,
	tabDeps: CreationTabDeps,
) {
	const {
		addEntry,
		defaultWorkspacePath,
		entries,
		setToastMessage,
		addPendingSave,
		removePendingSave,
		vaultPath,
		vaults,
		onNewNotePersisted,
	} = config;
	const { openTabWithContent } = tabDeps;
	const persistResolvedEntry = usePersistResolvedEntry(
		config,
		openTabWithContent,
	);
	const actions = useNamedCreationActions({
		defaultWorkspacePath,
		entries,
		persistResolvedEntry,
		setToastMessage,
		vaultPath,
		vaults,
	});

	const handleCreateNoteImmediate = useImmediateCreateQueue({
		entries,
		vaultPath,
		defaultWorkspacePath,
		vaults,
		addEntry,
		addPendingSave,
		openTabWithContent,
		onNewNotePersisted,
		removePendingSave,
		setToastMessage,
	});
	useCreateNoteInFolderRequests(handleCreateNoteImmediate);

	return {
		handleCreateNote: actions.handleCreateNote,
		handleCreateNoteFromWikilink: actions.handleCreateNoteFromWikilink,
		handleCreateNoteImmediate,
		handleCreateNoteForRelationship: actions.handleCreateNoteForRelationship,
		handleCreateType: actions.handleCreateType,
		createTypeEntrySilent: actions.createTypeEntrySilent,
	};
}
