import {
	type Dispatch,
	type SetStateAction,
	useEffect,
	useRef,
	useState,
} from "react";
import type { RemoteBindings } from "../../packages/collab-client/src/remoteVaultBackend";
import {
	type ActiveCollabDocument,
	publishActiveCollabDocument,
} from "../lib/activeCollabDocument";
import { reportAccessDenied } from "../lib/sharing/vaultAccess";
import type {
	VaultBackend,
	VaultCollabChannel,
	VaultCollabDoc,
} from "../lib/vaultBackend/types";

export interface CollabDocumentState {
	doc: VaultCollabDoc<RemoteBindings> | null;
	synced: boolean;
	error: Error | null;
}

interface UseCollabDocumentOptions {
	vaultBackend: VaultBackend<RemoteBindings> | null;
	path: string | null;
	enabled: boolean;
	/** Join without the ability to edit (TOL-237): a note shared with the user to view. */
	readOnly?: boolean;
}

/** The document to keep open: a note, joined to edit or only to read. */
interface DocumentTarget {
	path: string;
	readOnly: boolean;
}

/** The state of one opened document, with the session that opened it. */
type OpenedDocument = CollabDocumentState & { session: DocumentSession };

const NO_DOCUMENT: CollabDocumentState = {
	doc: null,
	synced: false,
	error: null,
};

function collabChannel(
	vaultBackend: VaultBackend<RemoteBindings> | null,
): VaultCollabChannel<RemoteBindings> | null {
	return vaultBackend?.collab ?? null;
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

/** One opened document, which the hook keeps while its note is renamed. */
interface DocumentSession {
	collab: VaultCollabChannel<RemoteBindings>;
	/** The note the document belongs to: the backend moves `doc.path` on a rename from this page. */
	path(): string;
	readOnly: boolean;
	leave(): void;
}

/**
 * The provider closes on its own only when the server refused the document (TOL-237: a share
 * revoked or reduced); the page then rechecks what it may still do. Leaving closes it too.
 */
function reportWhenRefused(
	doc: VaultCollabDoc<RemoteBindings>,
	hasLeft: () => boolean,
): void {
	doc.provider?.onStatus?.((status) => {
		if (status === "closed" && !hasLeft()) reportAccessDenied();
	});
}

function openCollabDocument(
	collab: VaultCollabChannel<RemoteBindings>,
	{ path, readOnly }: DocumentTarget,
	report: (state: OpenedDocument) => void,
): DocumentSession {
	let left = false;
	let opened: VaultCollabDoc<RemoteBindings> | null = null;
	const session: DocumentSession = {
		collab,
		readOnly,
		path: () => opened?.path ?? path,
		leave: () => {
			left = true;
			opened?.close();
		},
	};
	const update = (state: CollabDocumentState) => {
		if (!left) report({ ...state, session });
	};

	collab
		.openDoc(path, { readOnly })
		.then((doc) => {
			if (left) return doc.close();
			opened = doc;
			reportWhenRefused(doc, () => left);
			update({ doc, synced: false, error: null });
			return doc.synced.then(
				() => update({ doc, synced: true, error: null }),
				(error: unknown) =>
					update({ doc, synced: false, error: asError(error) }),
			);
		})
		.catch((error: unknown) =>
			update({ doc: null, synced: false, error: asError(error) }),
		);

	return session;
}

/** One string per target: a note joined to read is another document session than the same note to edit. */
function targetKey(target: DocumentTarget | null): string | null {
	return target && `${target.readOnly ? "read" : "write"}:${target.path}`;
}

function sessionKey(session: DocumentSession): string {
	return targetKey({ path: session.path(), readOnly: session.readOnly }) ?? "";
}

function isOpenAt(
	session: DocumentSession | undefined | null,
	collab: VaultCollabChannel<RemoteBindings> | null,
	target: DocumentTarget | null,
): boolean {
	return session?.collab === collab && sessionKey(session) === targetKey(target);
}

/**
 * Keeps one document open for `target`. A target the open document already moved to (a
 * rename from this page) keeps it; any other target closes it and opens the new one.
 */
function useDocumentSession(
	collab: VaultCollabChannel<RemoteBindings> | null,
	path: string | null,
	readOnly: boolean,
	setOpened: Dispatch<SetStateAction<OpenedDocument | null>>,
): void {
	const sessionRef = useRef<DocumentSession | null>(null);

	useEffect(() => {
		const target = path === null ? null : { path, readOnly };
		if (isOpenAt(sessionRef.current, collab, target)) return;
		sessionRef.current?.leave();
		setOpened(null);
		sessionRef.current =
			collab && target ? openCollabDocument(collab, target, setOpened) : null;
	}, [collab, path, readOnly, setOpened]);

	useEffect(() => () => sessionRef.current?.leave(), []);
}

/** What the status bar's sync pill reads: the document, or that one is being opened. */
function activeDocumentOf(
	target: string | null,
	state: CollabDocumentState,
): ActiveCollabDocument {
	if (state.doc) return state.doc;
	return target && !state.error ? "opening" : null;
}

function usePublishedDocument(document: ActiveCollabDocument): void {
	useEffect(() => publishActiveCollabDocument(document), [document]);
}

/**
 * Opens a Yjs collaborative document for the given note path.
 * Returns no document when collaboration is not available (desktop) or not enabled.
 * Manages the document lifecycle: opens on mount/path change, closes on unmount.
 * The state always belongs to `path`: while another note's document is still open or
 * closing, the hook reports no document rather than the previous note's. A note renamed from
 * this page keeps its open document, which followed the file. The document is published as
 * the active one while the hook holds it.
 */
export function useCollabDocument({
	vaultBackend,
	path,
	enabled,
	readOnly = false,
}: UseCollabDocumentOptions): CollabDocumentState {
	const [opened, setOpened] = useState<OpenedDocument | null>(null);
	const collab = enabled ? collabChannel(vaultBackend) : null;
	const target = collab ? path : null;
	useDocumentSession(collab, target, readOnly, setOpened);
	const current = target === null ? null : { path: target, readOnly };
	const state =
		opened && isOpenAt(opened.session, collab, current) ? opened : NO_DOCUMENT;
	usePublishedDocument(activeDocumentOf(target, state));
	return state;
}
