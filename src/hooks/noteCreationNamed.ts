import { useCallback } from "react";
import type { VaultOption } from "../components/status-bar/types";
import { trackEvent } from "../lib/telemetry";
import type { VaultEntry } from "../types";
import {
	resolveWikilinkCreationRequest,
	type WikilinkCreationDestination,
} from "../utils/wikilinkCreation";
import {
	createPersistFailureMessage,
	findTypeTargetCollision,
	planNewNoteCreation,
	planNewTypeCreation,
	type ResolvedEntry,
	resolveTemplate,
	resolveTypeInstanceDefaults,
} from "./noteCreationCore";
import { requestEditorFocus } from "./useEditorFocus";
import type { NoteCreationConfig } from "./useNoteCreation";

function signalFocusEditor(path?: string): void {
	requestEditorFocus({
		t0: performance.now(),
		selectTitle: false,
		path: path ?? null,
	});
}

export interface PersistResolvedOptions {
	openTab?: boolean;
}

export type PersistResolvedEntryFn = (
	resolved: ResolvedEntry,
	options?: PersistResolvedOptions,
) => Promise<void>;

export type NamedCreationOptions = Pick<
	NoteCreationConfig,
	| "defaultWorkspacePath"
	| "entries"
	| "setToastMessage"
	| "vaultPath"
	| "vaults"
> & { persistResolvedEntry: PersistResolvedEntryFn };

interface CreationDeps {
	defaultWorkspacePath?: string | null;
	entries: VaultEntry[];
	vaultPath: string;
	vaults?: readonly VaultOption[];
	setToastMessage: (msg: string | null) => void;
	persistResolvedEntry: PersistResolvedEntryFn;
}

interface NoteCreationRequest extends CreationDeps {
	destination?: WikilinkCreationDestination;
	focusEditor?: boolean;
	title: string;
	type: string;
	creationPath?: "plus_button" | "quick_open" | "wikilink";
}

async function createNamedNote(options: NoteCreationRequest): Promise<boolean> {
	const {
		creationPath,
		defaultWorkspacePath,
		destination,
		entries,
		focusEditor,
		persistResolvedEntry,
		setToastMessage,
		title,
		type,
		vaultPath,
		vaults,
	} = options;
	const template = resolveTemplate({ entries, typeName: type });
	const defaults = resolveTypeInstanceDefaults({ entries, typeName: type });
	const plan = planNewNoteCreation({
		destination,
		entries,
		title,
		type,
		vaultPath,
		defaultWorkspacePath,
		vaults,
		template,
		defaults,
	});
	if (plan.status === "blocked") {
		setToastMessage(plan.message);
		return false;
	}

	try {
		await persistResolvedEntry(plan.resolved);
		if (focusEditor) signalFocusEditor(plan.resolved.entry.path);
		if (creationPath) {
			trackEvent("note_created", {
				has_type: type !== "Note" ? 1 : 0,
				creation_path: creationPath,
			});
		}
		return true;
	} catch (error) {
		setToastMessage(createPersistFailureMessage(plan.resolved.entry, error));
		return false;
	}
}

interface TypeCreationRequest extends CreationDeps {
	typeName: string;
}

async function createTypeFromName({
	entries,
	defaultWorkspacePath,
	typeName,
	vaultPath,
	vaults,
	setToastMessage,
	persistResolvedEntry,
}: TypeCreationRequest): Promise<boolean> {
	const plan = planNewTypeCreation({
		entries,
		typeName,
		vaultPath,
		defaultWorkspacePath,
		vaults,
	});
	if (plan.status === "existing") {
		setToastMessage(`Type "${plan.entry.title}" already exists`);
		return false;
	}
	if (plan.status === "blocked") {
		setToastMessage(plan.message);
		return false;
	}

	const collisionMessage = await findTypeTargetCollision(plan.resolved);
	if (collisionMessage) {
		setToastMessage(collisionMessage);
		return false;
	}

	try {
		await persistResolvedEntry(plan.resolved);
		trackEvent("type_created");
		return true;
	} catch (error) {
		setToastMessage(createPersistFailureMessage(plan.resolved.entry, error));
		return false;
	}
}

async function createTypeSilently({
	entries,
	defaultWorkspacePath,
	typeName,
	vaultPath,
	vaults,
	setToastMessage,
	persistResolvedEntry,
}: TypeCreationRequest): Promise<VaultEntry> {
	const plan = planNewTypeCreation({
		entries,
		typeName,
		vaultPath,
		defaultWorkspacePath,
		vaults,
	});
	if (plan.status === "existing") return plan.entry;
	if (plan.status === "blocked") {
		setToastMessage(plan.message);
		throw new Error(plan.message);
	}

	const collisionMessage = await findTypeTargetCollision(plan.resolved);
	if (collisionMessage) {
		setToastMessage(collisionMessage);
		throw new Error(collisionMessage);
	}

	try {
		await persistResolvedEntry(plan.resolved, { openTab: false });
		return plan.resolved.entry;
	} catch (error) {
		const message = createPersistFailureMessage(plan.resolved.entry, error);
		setToastMessage(message);
		throw new Error(message, { cause: error });
	}
}

function useCreateNoteFromWikilink(options: NamedCreationOptions) {
	const {
		defaultWorkspacePath,
		entries,
		persistResolvedEntry,
		setToastMessage,
		vaultPath,
		vaults,
	} = options;
	return useCallback(
		(target: string, sourceEntry?: VaultEntry): Promise<boolean> => {
			const request = resolveWikilinkCreationRequest({
				fallbackVaultPath: vaultPath,
				sourceEntry,
				target,
				vaults,
			});
			if (!request) return Promise.resolve(false);
			return createNamedNote({
				entries,
				vaultPath,
				defaultWorkspacePath,
				vaults,
				setToastMessage,
				persistResolvedEntry,
				destination: request.destination,
				focusEditor: true,
				title: request.title,
				type: "Note",
				creationPath: "wikilink",
			});
		},
		[
			entries,
			vaultPath,
			defaultWorkspacePath,
			vaults,
			setToastMessage,
			persistResolvedEntry,
		],
	);
}

function useTypeCreationHandler<Result>(
	options: NamedCreationOptions,
	create: (request: TypeCreationRequest) => Promise<Result>,
) {
	const {
		entries,
		vaultPath,
		defaultWorkspacePath,
		vaults,
		setToastMessage,
		persistResolvedEntry,
	} = options;
	return useCallback(
		(typeName: string) =>
			create({
				entries,
				vaultPath,
				defaultWorkspacePath,
				vaults,
				setToastMessage,
				persistResolvedEntry,
				typeName,
			}),
		[
			entries,
			vaultPath,
			defaultWorkspacePath,
			vaults,
			setToastMessage,
			persistResolvedEntry,
			create,
		],
	);
}

function useTypeCreationActions(options: NamedCreationOptions) {
	const handleCreateType = useTypeCreationHandler(options, createTypeFromName);
	const createTypeEntrySilent = useTypeCreationHandler(
		options,
		createTypeSilently,
	);
	return { createTypeEntrySilent, handleCreateType };
}

function useNamedNoteHandlers(options: NamedCreationOptions) {
	const {
		entries,
		vaultPath,
		defaultWorkspacePath,
		vaults,
		setToastMessage,
		persistResolvedEntry,
	} = options;
	const handleCreateNote = useCallback(
		(
			title: string,
			type: string,
			creationPath: "plus_button" | "quick_open" = "plus_button",
		) =>
			createNamedNote({
				entries,
				vaultPath,
				defaultWorkspacePath,
				vaults,
				setToastMessage,
				persistResolvedEntry,
				title,
				type,
				creationPath,
			}),
		[
			entries,
			vaultPath,
			defaultWorkspacePath,
			vaults,
			setToastMessage,
			persistResolvedEntry,
		],
	);
	const handleCreateNoteForRelationship = useCallback(
		(title: string) => handleCreateNote(title, "Note"),
		[handleCreateNote],
	);
	return { handleCreateNote, handleCreateNoteForRelationship };
}

export function useNamedCreationActions(options: NamedCreationOptions) {
	const noteHandlers = useNamedNoteHandlers(options);
	const handleCreateNoteFromWikilink = useCreateNoteFromWikilink(options);
	const typeActions = useTypeCreationActions(options);
	return { ...noteHandlers, ...typeActions, handleCreateNoteFromWikilink };
}
