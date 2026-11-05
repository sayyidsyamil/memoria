import type { EditorView } from "@codemirror/view";
import { act, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import type { RemoteBindings } from "../../packages/collab-client/src/remoteVaultBackend";
import { DOC_FRONTMATTER_FIELD } from "../../packages/protocol/src/index";
import { resolvePlatformCapabilities } from "../lib/platformCapabilities";
import type {
	VaultBackend,
	VaultCollabChannel,
	VaultCollabDoc,
} from "../lib/vaultBackend/types";
import {
	blockNoteCreation,
	blockNoteViewState,
	flushEditorSwapWork,
	mockEditor,
	mockTab,
	renderEditor,
	resetEditorTestState,
} from "./Editor.helpers.test";

// TOL-190: on the web, the rich editor is bound to the note's live document once it has
// synced, and the tab-swap content load and onContentChange saves stay out of its way.

interface CollabCreationOptions {
	collaboration?: { fragment: unknown; provider: unknown };
}

function latestCollaboration() {
	return (blockNoteCreation.options.at(-1) as CollabCreationOptions | undefined)
		?.collaboration;
}

function deferred() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function liveDocument(synced: Promise<void>): VaultCollabDoc<RemoteBindings> {
	return {
		path: mockTab.entry.path,
		doc: { id: "doc", clientID: 1 } as unknown as RemoteBindings["doc"],
		fragment: { id: "fragment" } as unknown as RemoteBindings["fragment"],
		provider: { id: "provider" } as unknown as RemoteBindings["provider"],
		awareness: new Awareness(new Y.Doc()),
		synced,
		close: vi.fn(),
	};
}

function remoteBackend(
	openDoc: VaultCollabChannel<RemoteBindings>["openDoc"],
): VaultBackend<RemoteBindings> {
	return {
		kind: "remote",
		interfaceVersion: 1,
		capabilities: {
			collaboration: true,
			atomicRevisions: true,
			attachments: false,
		},
		files: {} as VaultBackend["files"],
		chrome: {} as VaultBackend["chrome"],
		collab: { openDoc },
	};
}

function renderWebEditor(
	vaultBackend: VaultBackend<RemoteBindings>,
	onContentChange = vi.fn(),
	rawToggleRef?: { current: () => void },
) {
	renderEditor({
		tabs: [mockTab],
		activeTabPath: mockTab.entry.path,
		platformCapabilities: resolvePlatformCapabilities("remote"),
		vaultBackend,
		onContentChange,
		rawToggleRef,
	});
	return onContentChange;
}

type CodeMirrorElement = HTMLElement & { __cmView?: EditorView };

function rawEditorView(): EditorView {
	const element = screen.getByTestId("raw-editor-codemirror");
	return (element as CodeMirrorElement).__cmView as EditorView;
}

async function toggleRaw(rawToggleRef: { current: () => void }) {
	await act(async () => {
		rawToggleRef.current();
	});
	await flushEditorSwapWork();
}

describe("Editor collaboration binding", () => {
	beforeEach(() => {
		resetEditorTestState();
		mockEditor.replaceBlocks.mockClear();
	});

	it("loads nothing into the editor while the live document is syncing", async () => {
		const sync = deferred();
		const openDoc = vi.fn().mockResolvedValue(liveDocument(sync.promise));
		renderWebEditor(remoteBackend(openDoc));
		await flushEditorSwapWork();

		expect(openDoc).toHaveBeenCalledWith(mockTab.entry.path, { readOnly: false });
		expect(latestCollaboration()).toBeUndefined();
		expect(screen.queryByTestId("blocknote-view")).not.toBeInTheDocument();
		expect(mockEditor.replaceBlocks).not.toHaveBeenCalled();
	});

	it("binds a new editor to the synced document and saves nothing through onContentChange", async () => {
		const document = liveDocument(Promise.resolve());
		const openDoc = vi.fn().mockResolvedValue(document);
		const onContentChange = renderWebEditor(remoteBackend(openDoc));
		await flushEditorSwapWork();

		expect(latestCollaboration()).toMatchObject({
			fragment: document.fragment,
			provider: document.provider,
		});
		expect(screen.getByTestId("blocknote-view")).toBeInTheDocument();
		expect(mockEditor.replaceBlocks).not.toHaveBeenCalled();

		act(() => blockNoteViewState.onChange?.());
		await flushEditorSwapWork();
		expect(onContentChange).not.toHaveBeenCalled();
	});

	it("opens raw mode on the live document and saves raw edits into it (TOL-221)", async () => {
		const doc = new Y.Doc();
		doc.getText(DOC_FRONTMATTER_FIELD).insert(0, "---\nstatus: Live\n---\n");
		const document = { ...liveDocument(Promise.resolve()), doc };
		const rawToggleRef = { current: () => {} };
		const onContentChange = renderWebEditor(
			remoteBackend(vi.fn().mockResolvedValue(document)),
			vi.fn(),
			rawToggleRef,
		);
		await flushEditorSwapWork();

		await toggleRaw(rawToggleRef);
		const view = rawEditorView();
		expect(view.state.doc.toString()).toMatch(/^---\nstatus: Live\n---\n/);
		act(() => {
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: "---\nstatus: Raw\n---\nRaw body\n" },
			});
		});
		await toggleRaw(rawToggleRef);

		await waitFor(() =>
			expect(doc.getText(DOC_FRONTMATTER_FIELD).toString()).toBe("---\nstatus: Raw\n---\n"),
		);
		expect(onContentChange).not.toHaveBeenCalled();
		expect(screen.queryByTestId("raw-editor-codemirror")).not.toBeInTheDocument();
	});

	it("falls back to the tab content when the live document cannot be opened", async () => {
		const openDoc = vi.fn().mockRejectedValue(new Error("not a note"));
		renderWebEditor(remoteBackend(openDoc));
		await flushEditorSwapWork();

		expect(latestCollaboration()).toBeUndefined();
		expect(screen.getByTestId("blocknote-view")).toBeInTheDocument();
		expect(mockEditor.replaceBlocks).toHaveBeenCalled();
	});

	it("keeps the desktop editor local and never opens a live document", async () => {
		const openDoc = vi.fn();
		renderEditor({
			tabs: [mockTab],
			activeTabPath: mockTab.entry.path,
			platformCapabilities: resolvePlatformCapabilities("tauri"),
			vaultBackend: remoteBackend(openDoc),
		});
		await flushEditorSwapWork();

		expect(openDoc).not.toHaveBeenCalled();
		expect(latestCollaboration()).toBeUndefined();
		expect(mockEditor.replaceBlocks).toHaveBeenCalled();
	});
});
