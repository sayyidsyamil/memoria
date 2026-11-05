import { useCallback, useState } from "react";
import { useLiveNoteDocument } from "../lib/liveNoteDocuments";
import { reportLiveNoteTitle } from "../lib/liveNoteTitle";
import type { RemoteBindings } from "../../packages/collab-client/src/remoteVaultBackend";
import { useOfflineReadOnly } from "../hooks/useOfflineReadOnly";
import { useVaultAccess } from "../hooks/useVaultAccess";
import {
	canWritePath,
	type VaultAccessState,
} from "../lib/sharing/vaultAccess";
import type { PlatformCapabilities } from "../lib/platformCapabilities";
import type { VaultBackend, VaultCollabDoc } from "../lib/vaultBackend/types";
import type { VaultEntry } from "../types";
import { noteDisplaysAsSheet } from "../utils/noteFormat";
import {
	type CollabDocumentState,
	useCollabDocument,
} from "./useCollabDocument";
import { useLocalPresence } from "./useLocalPresence";

/**
 * How the rich editor of the active note gets and keeps its content:
 *  - `local`: from the tab's markdown, saved through `onContentChange` (desktop, mock web,
 *    sheets, or a note whose live document could not be opened);
 *  - `pending`: the note's live document is opening; the editor shows nothing yet and loads
 *    or saves nothing, so it cannot race the document;
 *  - `bound`: BlockNote edits the live document's shared fragment, which the server writes
 *    to the file. The tab-swap content load and `onContentChange` saves stay off; edits
 *    report the note's first H1 instead (`reportLiveNoteTitle`), for the untitled rename.
 */
export type CollabEditorBinding =
	| { kind: "local" }
	| { kind: "pending" }
	| { kind: "bound"; doc: VaultCollabDoc<RemoteBindings> };

interface CollabTab {
	entry: Pick<VaultEntry, "path" | "display" | "fileKind">;
	content: string;
}

interface CollabEditorBindingOptions {
	tabs: CollabTab[];
	activeTabPath: string | null;
	vaultBackend?: VaultBackend<RemoteBindings> | null;
	platformCapabilities?: PlatformCapabilities;
}

const LOCAL: CollabEditorBinding = { kind: "local" };
const PENDING: CollabEditorBinding = { kind: "pending" };

/** The note path to open as a live document, or null when the note stays local. */
export function collabNotePath({
	tabs,
	activeTabPath,
	vaultBackend,
	platformCapabilities,
}: CollabEditorBindingOptions): string | null {
	if (!platformCapabilities?.perNoteEditors || !vaultBackend?.collab)
		return null;
	const activeTab = tabs.find((tab) => tab.entry.path === activeTabPath);
	if (!activeTab?.entry.path.toLowerCase().endsWith(".md")) return null;
	const isSheet = noteDisplaysAsSheet({
		content: activeTab.content,
		display: activeTab.entry.display,
		fileKind: activeTab.entry.fileKind,
	});
	return isSheet ? null : activeTab.entry.path;
}

export function resolveCollabEditorBinding(
	path: string | null,
	state: CollabDocumentState,
): CollabEditorBinding {
	if (!path || state.error) return LOCAL;
	if (state.doc && state.synced) return { kind: "bound", doc: state.doc };
	return PENDING;
}

/**
 * The live document to open while offline (TOL-198): none, unless the note is already bound.
 * Opening a document needs the server, and a document opened offline would keep edits
 * locally to send later. A bound note keeps its document so it stays readable; the editor
 * is read-only meanwhile, so nothing is queued in it.
 */
export function offlineCollabPath(
	path: string | null,
	offline: boolean,
	boundPath: string | null,
): string | null {
	return !offline || path === boundPath ? path : null;
}

/**
 * The live document to open in a shared vault (TOL-237): none until the access is known, or
 * once it is revoked, so a viewer never asks for an edit ticket.
 */
export function accessCollabPath(
	path: string | null,
	access: VaultAccessState,
): string | null {
	return access.kind === "checking" || access.kind === "revoked" ? null : path;
}

/**
 * Opens the active note's live document when the platform edits notes collaboratively, and
 * registers it while bound so property edits go into it.
 */
export function useCollabEditorBinding(
	options: CollabEditorBindingOptions,
): CollabEditorBinding {
	const offline = useOfflineReadOnly();
	const access = useVaultAccess();
	const [boundPath, setBoundPath] = useState<string | null>(null);
	const path = accessCollabPath(
		offlineCollabPath(collabNotePath(options), offline, boundPath),
		access,
	);
	const state = useCollabDocument({
		vaultBackend: options.vaultBackend ?? null,
		path,
		enabled: path !== null,
		readOnly: path !== null && !canWritePath(access, path),
	});
	useLocalPresence(state.doc);
	const binding = resolveCollabEditorBinding(path, state);
	const nowBound = binding.kind === "bound" ? path : null;
	if (nowBound !== boundPath) setBoundPath(nowBound);
	// Property edits go into the bound document (TOL-203).
	useLiveNoteDocument(binding.kind === "bound" ? binding.doc : null);
	return binding;
}

interface InlineNode {
	type?: string;
	text?: string;
	content?: unknown;
}

export interface TitleBlock {
	type: string;
	props?: { level?: unknown };
	content?: unknown;
}

function inlineText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return (content as InlineNode[])
		.map((node) => node.text ?? inlineText(node.content))
		.join("");
}

/**
 * The note's title as the desktop reads it from markdown: the first non-empty block, when it
 * is an H1. Null when the note does not start with one.
 */
export function liveDocumentTitle(blocks: readonly TitleBlock[]): string | null {
	const first = blocks.find((block) => inlineText(block.content).trim() !== "");
	const isH1 = first?.type === "heading" && (first.props?.level ?? 1) === 1;
	return isH1 ? inlineText(first.content).trim() : null;
}

/** The editor-change handler of a bound editor: it reports the first H1 and saves nothing. */
export function useLiveTitleReporter(
	binding: CollabEditorBinding,
	editor: { document: readonly TitleBlock[] },
	path: string | null,
): () => void {
	const bound = binding.kind === "bound";
	return useCallback(() => {
		if (bound && path) reportLiveNoteTitle(path, liveDocumentTitle(editor.document));
	}, [bound, editor, path]);
}

const documentKeys = new WeakMap<object, number>();
let lastDocumentKey = 0;

function documentKey(doc: object): number {
	let key = documentKeys.get(doc);
	if (key === undefined) {
		lastDocumentKey += 1;
		key = lastDocumentKey;
		documentKeys.set(doc, key);
	}
	return key;
}

/**
 * The key of the editor instance: a bound editor is a new instance, because BlockNote binds
 * to a document only when it is created. It is keyed by its document, not its path, so a
 * note renamed while open (the untitled rename) keeps its editor, caret and focus.
 */
export function collabEditorKey(
	perNoteEditors: boolean | undefined,
	activeTabPath: string | null,
	binding: CollabEditorBinding,
): string {
	if (!perNoteEditors) return "shared-editor";
	if (binding.kind === "bound")
		return `editor-collab-${documentKey(binding.doc)}`;
	return `editor-${activeTabPath ?? "none"}`;
}
