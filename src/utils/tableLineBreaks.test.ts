import { readFileSync } from "node:fs";
import { BlockNoteEditor } from "@blocknote/core";
import { describe, expect, it } from "vitest";
import { schema } from "../components/editorSchema";
import { tryParseFastMarkdownBlocks } from "../hooks/editorFastMarkdownBlocks";
import { blocksToMarkdownDirect } from "./blockNoteDirectMarkdown";
import {
	injectRichEditorMarkdownBlocks,
	preProcessRichEditorMarkdown,
} from "./richEditorMarkdown";
import {
	injectTableCellBreaks,
	preProcessTableCellBreaks,
} from "./tableCellBreakMarkdown";

const tableMarkdown = readFileSync(
	"src/test/fixtures/table-line-breaks.md",
	"utf8",
).trim();

describe("durable table cell line breaks", () => {
	it("writes a cell newline as portable HTML without splitting the Markdown row", () => {
		const blocks = [
			{
				type: "table",
				content: {
					type: "tableContent",
					rows: [
						{ cells: ["Header", "Other"] },
						{
							cells: [
								{
									content: [
										{ type: "text", text: "first\nsecond", styles: {} },
									],
								},
								"value",
							],
						},
					],
				},
			},
		];
		expect(blocksToMarkdownDirect(blocks).markdown).toBe(tableMarkdown);
	});

	it.each([
		"",
		"/",
		" /",
	])("keeps imported br%s cell breaks through reload", async (suffix) => {
		const markdown = tableMarkdown.replace(/br>/gu, `br${suffix}>`);
		const editor = BlockNoteEditor.create({ schema });
		const parsed = await editor.tryParseMarkdownToBlocks(
			preProcessRichEditorMarkdown(markdown),
		);
		const blocks = injectRichEditorMarkdownBlocks(parsed);
		expect(blocksToMarkdownDirect(blocks).markdown).toBe(tableMarkdown);
	});
});

describe("table break import boundaries", () => {
	it.each([
		"---",
		String.raw`---\|---`,
	])("does not protect breaks above a non-table separator %s", (separator) => {
		const markdown = `a <br> | b\n${separator}`;
		expect(preProcessTableCellBreaks(markdown)).toBe(markdown);
		expect(tryParseFastMarkdownBlocks(markdown).blocks).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ type: "table" })]),
		);
	});
	it("keeps escaped pipes and cell breaks in the same cell through both parsers", async () => {
		const markdown = readFileSync(
			"src/test/fixtures/table-escaped-pipe-breaks.md",
			"utf8",
		).trim();
		const source = preProcessRichEditorMarkdown(markdown);
		const editor = BlockNoteEditor.create({ schema });
		const documents = [
			await editor.tryParseMarkdownToBlocks(source),
			tryParseFastMarkdownBlocks(source).blocks,
		];
		for (const blocks of documents) {
			expect(
				blocksToMarkdownDirect(injectRichEditorMarkdownBlocks(blocks)).markdown,
			).toBe(markdown);
		}
	});
	it("preserves literal breaks outside tables, inside code, and escaped tags", () => {
		const source = readFileSync(
			"src/test/fixtures/table-break-boundaries.md",
			"utf8",
		);
		expect(preProcessTableCellBreaks(source)).toBe(source);
	});
	it("keeps unchanged block identities for serialization caches", () => {
		const blocks = [
			{ type: "paragraph", content: [{ type: "text", text: "hello" }] },
		];
		expect(injectTableCellBreaks(blocks)).toBe(blocks);
	});
});

it("restores breaks through the large-note fast parser too", () => {
	const markdown = tableMarkdown;
	const parsed = tryParseFastMarkdownBlocks(
		preProcessRichEditorMarkdown(markdown),
	);
	expect(parsed.supported).toBe(true);
	expect(
		blocksToMarkdownDirect(injectRichEditorMarkdownBlocks(parsed.blocks))
			.markdown,
	).toBe(markdown);
});
