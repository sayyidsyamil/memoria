import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RemoteBindings } from "../../packages/collab-client/src/remoteVaultBackend";
import { onLiveNoteTitle } from "../lib/liveNoteTitle";
import { resolvePlatformCapabilities } from "../lib/platformCapabilities";
import type { VaultBackend, VaultCollabDoc } from "../lib/vaultBackend/types";
import {
	collabEditorKey,
	collabNotePath,
	liveDocumentTitle,
	resolveCollabEditorBinding,
	type TitleBlock,
	useLiveTitleReporter,
} from "./collabEditorBinding";

const web = resolvePlatformCapabilities("remote");
const desktop = resolvePlatformCapabilities("tauri");
const backend = {
	collab: { openDoc: async () => doc },
} as unknown as VaultBackend<RemoteBindings>;
const doc = { path: "note.md" } as VaultCollabDoc<RemoteBindings>;

function tab(
	path: string,
	content = "# Note\n",
	fileKind: "markdown" | "binary" = "markdown",
) {
	return { entry: { path, display: null, fileKind }, content };
}

const tabs = [tab("note.md"), tab("photo.png", "", "binary")];

function notePath(overrides: Partial<Parameters<typeof collabNotePath>[0]>) {
	return collabNotePath({
		tabs,
		activeTabPath: "note.md",
		vaultBackend: backend,
		platformCapabilities: web,
		...overrides,
	});
}

const LOCAL_CASES: [string, Partial<Parameters<typeof collabNotePath>[0]>][] = [
	["desktop", { platformCapabilities: desktop }],
	[
		"no collaboration channel",
		{ vaultBackend: { collab: null } as VaultBackend<RemoteBindings> },
	],
	["no backend", { vaultBackend: null }],
	["a tab that has not loaded", { activeTabPath: "other.md" }],
	["a binary file", { activeTabPath: "photo.png" }],
	[
		"a note shown as a sheet",
		{
			tabs: [
				{
					entry: { path: "note.md", display: "sheet", fileKind: "markdown" },
					content: "| a |\n",
				},
			],
		},
	],
];

describe("collabNotePath", () => {
	it("opens markdown notes on the web", () => {
		expect(notePath({})).toBe("note.md");
	});

	it.each(LOCAL_CASES)("keeps the note local for %s", (_label, overrides) => {
		expect(notePath(overrides)).toBeNull();
	});
});

describe("resolveCollabEditorBinding", () => {
	it("is local without a path or after an error", () => {
		expect(
			resolveCollabEditorBinding(null, {
				doc: null,
				synced: false,
				error: null,
			}),
		).toEqual({ kind: "local" });
		expect(
			resolveCollabEditorBinding("note.md", {
				doc,
				synced: false,
				error: new Error("x"),
			}),
		).toEqual({ kind: "local" });
	});

	it("is pending until the document has synced, then bound", () => {
		expect(
			resolveCollabEditorBinding("note.md", {
				doc: null,
				synced: false,
				error: null,
			}),
		).toEqual({ kind: "pending" });
		expect(
			resolveCollabEditorBinding("note.md", {
				doc,
				synced: false,
				error: null,
			}),
		).toEqual({ kind: "pending" });
		expect(
			resolveCollabEditorBinding("note.md", { doc, synced: true, error: null }),
		).toEqual({ kind: "bound", doc });
	});
});

describe("collabEditorKey", () => {
	it("keeps one shared editor on desktop", () => {
		expect(collabEditorKey(false, "a.md", { kind: "local" })).toBe(
			"shared-editor",
		);
		expect(collabEditorKey(undefined, "b.md", { kind: "bound", doc })).toBe(
			"shared-editor",
		);
	});

	it("creates a new web editor per note and again once it is bound", () => {
		expect(collabEditorKey(true, null, { kind: "local" })).toBe("editor-none");
		expect(collabEditorKey(true, "a.md", { kind: "pending" })).toBe(
			"editor-a.md",
		);
		expect(collabEditorKey(true, "a.md", { kind: "bound", doc })).toMatch(
			/^editor-collab-\d+$/,
		);
	});

	it("keeps a bound editor when its note is renamed, and not for another document", () => {
		const other = { path: "other.md" } as VaultCollabDoc<RemoteBindings>;
		const bound = collabEditorKey(true, "untitled-note-1.md", {
			kind: "bound",
			doc,
		});

		expect(collabEditorKey(true, "big-idea.md", { kind: "bound", doc })).toBe(
			bound,
		);
		expect(
			collabEditorKey(true, "untitled-note-1.md", { kind: "bound", doc: other }),
		).not.toBe(bound);
	});
});

function heading(text: string, level = 1): TitleBlock {
	return { type: "heading", props: { level }, content: [{ type: "text", text }] };
}

function paragraph(text: string): TitleBlock {
	return { type: "paragraph", props: {}, content: text ? [{ type: "text", text }] : [] };
}

describe("liveDocumentTitle", () => {
	it("reads the first H1, like the desktop reads it from markdown", () => {
		expect(liveDocumentTitle([paragraph(""), heading(" Big Idea "), paragraph("Body")])).toBe(
			"Big Idea",
		);
		expect(
			liveDocumentTitle([
				{
					type: "heading",
					props: { level: 1 },
					content: [
						{ type: "text", text: "See " },
						{ type: "link", content: [{ type: "text", text: "Ada" }] },
					],
				},
			]),
		).toBe("See Ada");
	});

	it("is null when the note does not start with an H1", () => {
		expect(liveDocumentTitle([])).toBeNull();
		expect(liveDocumentTitle([heading("")])).toBeNull();
		expect(liveDocumentTitle([heading("Section", 2)])).toBeNull();
		expect(liveDocumentTitle([paragraph("Intro"), heading("Late title")])).toBeNull();
		expect(liveDocumentTitle([{ type: "table", content: { rows: [] } }])).toBeNull();
	});
});

describe("useLiveTitleReporter", () => {
	it("reports the title of a bound note and nothing for a local one", () => {
		const reported: [string, string | null][] = [];
		const stop = onLiveNoteTitle((path, title) => reported.push([path, title]));
		const editor = { document: [heading("Big Idea")] };

		renderHook(() => useLiveTitleReporter({ kind: "bound", doc }, editor, "note.md")).result.current();
		renderHook(() => useLiveTitleReporter({ kind: "local" }, editor, "note.md")).result.current();
		renderHook(() => useLiveTitleReporter({ kind: "bound", doc }, editor, null)).result.current();
		stop();
		renderHook(() => useLiveTitleReporter({ kind: "bound", doc }, editor, "note.md")).result.current();

		expect(reported).toEqual([["note.md", "Big Idea"]]);
	});
});
