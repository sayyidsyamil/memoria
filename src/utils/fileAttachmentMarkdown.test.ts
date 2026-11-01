import { describe, expect, it, vi } from "vitest";
import {
	injectDurableEditorMarkdownBlocks,
	preProcessDurableEditorMarkdown,
} from "./editorDurableMarkdown";
import { preProcessFileAttachmentMarkdown } from "./fileAttachmentMarkdown";
import { serializeRichEditorDocumentToMarkdown } from "./richEditorMarkdown";

vi.mock("@tauri-apps/api/core", () => ({
	convertFileSrc: (path: string) =>
		`asset://localhost/${encodeURIComponent(path)}`,
}));

function makeEditor(document: unknown[], markdownLossy = "") {
	return {
		document,
		blocksToMarkdownLossy: vi.fn(() => markdownLossy),
	};
}

function fileBlock(name: string, url: string) {
	return {
		children: [],
		props: { name, url },
		type: "file",
	};
}

function serializeFileBlocks(blocks: unknown[], markdownLossy = "") {
	return serializeRichEditorDocumentToMarkdown({
		editor: makeEditor(blocks, markdownLossy) as never,
		notePath: "a.md",
		tabContent: "---\ntitle: Note A\n---\n",
		vaultPath: "/vault",
	});
}

function parsePreprocessedParagraph(markdown: string) {
	return [
		{
			type: "paragraph",
			content: [{ type: "text", text: markdown.trim(), styles: {} }],
			children: [],
		},
	];
}

function attachmentTokenCount(markdown: string): number {
	return markdown.match(/@@MEMORIA_FILE_ATTACHMENT:/gu)?.length ?? 0;
}

describe("file attachment Markdown roundtrip", () => {
	it("serializes file blocks as portable attachment links", () => {
		expect(
			serializeFileBlocks([
				fileBlock(
					"report.pdf",
					"asset://localhost/%2Fvault%2Fattachments%2Freport.pdf",
				),
			]),
		).toBe("---\ntitle: Note A\n---\n[report.pdf](attachments/report.pdf)\n");
	});

	it("normalizes embedded file paths from the current attachments folder", () => {
		const pdfPath = "/vault/attachments/project brief.pdf";
		const editor = makeEditor(
			[fileBlock("project brief.pdf", pdfPath)],
			"unreachable lossy markdown",
		);

		expect(
			serializeRichEditorDocumentToMarkdown({
				editor: editor as never,
				notePath: "a.md",
				tabContent: "---\ntitle: Note A\n---\n",
				vaultPath: "/vault",
			}),
		).toContain("attachments/project brief.pdf");
		expect(editor.blocksToMarkdownLossy).not.toHaveBeenCalled();
	});

	it("keeps embedded file paths outside the current attachments folder untouched", () => {
		const pdfPath = "/shared/attachments/project brief.pdf";
		expect(
			serializeFileBlocks(
				[fileBlock("project brief.pdf", pdfPath)],
				"[project brief.pdf](/shared/attachments/project%20brief.pdf)",
			),
		).toBe(
			"---\ntitle: Note A\n---\n[project brief.pdf](/shared/attachments/project%20brief.pdf)\n",
		);
	});

	it("rebuilds file blocks from standalone attachment links", () => {
		const preprocessed = preProcessDurableEditorMarkdown({
			markdown: "[report.pdf](attachments/report.pdf)\n",
		});

		expect(
			injectDurableEditorMarkdownBlocks(
				parsePreprocessedParagraph(preprocessed),
			),
		).toEqual([
			expect.objectContaining({
				type: "file",
				props: expect.objectContaining({
					name: "report.pdf",
					url: "attachments/report.pdf",
				}),
			}),
		]);
	});

	it("does not rebuild attachment links inside backtick or tilde fenced code", () => {
		const markdown = [
			"[outside.pdf](attachments/outside.pdf)",
			"```md",
			"[inside.pdf](attachments/inside.pdf)",
			"```",
			"~~~md",
			"[inside-tilde.pdf](attachments/inside-tilde.pdf)",
			"~~~",
			"[after.pdf](attachments/after.pdf)",
		].join("\n");

		const preprocessed = preProcessFileAttachmentMarkdown({ markdown });

		expect(attachmentTokenCount(preprocessed)).toBe(2);
		expect(preprocessed).toContain("[inside.pdf](attachments/inside.pdf)");
		expect(preprocessed).toContain(
			"[inside-tilde.pdf](attachments/inside-tilde.pdf)",
		);
		expect(preprocessed).not.toContain(
			"[outside.pdf](attachments/outside.pdf)",
		);
		expect(preprocessed).not.toContain("[after.pdf](attachments/after.pdf)");
	});

	it("requires a closing fence to be at least as long as the opening fence", () => {
		const markdown = [
			"````md",
			"[inside.pdf](attachments/inside.pdf)",
			"```",
			"[still-inside.pdf](attachments/still-inside.pdf)",
			"````",
			"[outside.pdf](attachments/outside.pdf)",
		].join("\n");

		const preprocessed = preProcessFileAttachmentMarkdown({ markdown });

		expect(attachmentTokenCount(preprocessed)).toBe(1);
		expect(preprocessed).toContain("[inside.pdf](attachments/inside.pdf)");
		expect(preprocessed).toContain(
			"[still-inside.pdf](attachments/still-inside.pdf)",
		);
		expect(preprocessed).not.toContain(
			"[outside.pdf](attachments/outside.pdf)",
		);
	});
});

describe("persisted PDF preview URLs", () => {
	it.each([
		"/vault",
		"C:\\Music Vault",
	])("resolves portable PDF links inside %s before rendering", async (vaultPath) => {
		const { preProcessRichEditorMarkdown } = await import(
			"./richEditorMarkdown"
		);
		const markdown =
			serializeFileBlocks([
				fileBlock(
					"Album (音楽).pdf",
					`asset://localhost/${encodeURIComponent("/vault/attachments/Album (音楽).pdf")}`,
				),
			])
				.split("\n")
				.find((line) => line.startsWith("[Album")) ?? "";
		const prepared = preProcessRichEditorMarkdown(markdown, vaultPath);
		const blocks = injectDurableEditorMarkdownBlocks(
			parsePreprocessedParagraph(prepared),
		);
		expect(blocks[0]).toMatchObject({
			type: "file",
			props: {
				url: expect.stringMatching(/^asset:\/\/localhost\//),
			},
		});
		expect(
			decodeURIComponent((blocks[0] as ReturnType<typeof fileBlock>).props.url),
		).toContain("Album (音楽).pdf");
	});
});

describe("captioned file links", () => {
	it("roundtrips escaped captions and spaced destinations", () => {
		const block = fileBlock(
			"Album.pdf",
			"asset://localhost/%2Fvault%2Fattachments%2FAlbum%20one.pdf",
		);
		const markdown =
			serializeFileBlocks([
				{ ...block, props: { ...block.props, caption: 'Album "one"' } },
			])
				.split("\n")
				.find((line) => line.startsWith("[Album")) ?? "";
		const prepared = preProcessFileAttachmentMarkdown({ markdown });
		expect(
			injectDurableEditorMarkdownBlocks(parsePreprocessedParagraph(prepared)),
		).toEqual([
			expect.objectContaining({
				type: "file",
				props: expect.objectContaining({
					name: "Album.pdf",
					url: "attachments/Album one.pdf",
					caption: 'Album "one"',
				}),
			}),
		]);
	});
});
