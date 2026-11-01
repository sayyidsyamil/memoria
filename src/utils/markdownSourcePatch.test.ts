import { describe, expect, it } from "vitest";
import integrityMarkdown from "../test/fixtures/markdown-integrity.md?raw";
import renderedMarkdown from "../test/fixtures/markdown-integrity-rendered.md?raw";
import {
	createMarkdownSourceMap,
	patchMarkdownSource,
	patchMarkdownSourceWithMap,
} from "./markdownSourcePatch";
import {
	readRichEditorSource,
	rememberRichEditorSource,
} from "./richEditorSourceState";

describe("source-preserving rich edits", () => {
	it("applies a single character edit without rewriting invisible HTML, entities or tables", () => {
		const source = integrityMarkdown.replace(/\n/g, "\r\n");
		const baseline = renderedMarkdown;
		expect(
			patchMarkdownSource(
				source,
				baseline,
				baseline.replace("Inline code:", "Inline codes:"),
			),
		).toBe(source.replace("Inline code:", "Inline codes:"));
	});

	it("preserves source bytes when the rich document has no changes", () => {
		expect(patchMarkdownSource("A &amp; B\r\n", "A & B\n", "A & B\n")).toBe(
			"A &amp; B\r\n",
		);
	});

	it("keeps source spellings across separate edits and real wikilink changes", () => {
		const source = "One &amp; two.\n\n[[Old]] and snake_case.\n";
		const baseline = "One & two.\n\n[[Old]] and snake_case.\n";
		const next = "Ones & two.\n\n[[New]] and snake_case!\n";
		expect(patchMarkdownSource(source, baseline, next)).toBe(
			"Ones &amp; two.\n\n[[New]] and snake_case!\n",
		);
	});

	it("allows deleting visible content adjacent to an invisible HTML placeholder", () => {
		const placeholder = integrityMarkdown.split("\n")[1];
		const source = `${placeholder.replace("Placeholder:", "ABC")}\n`;
		const expected = `${placeholder.replace("Placeholder:", "AB")}\n`;
		expect(patchMarkdownSource(source, "ABC \n", "AB \n")).toBe(expected);
	});

	it("edits entity text without modifying a matching invisible placeholder", () => {
		const source = integrityMarkdown;
		const baseline = renderedMarkdown;
		expect(
			patchMarkdownSource(source, baseline, baseline.replace("term", "terms")),
		).toBe(source.replace("&lt;term&gt;", "&lt;terms&gt;"));
	});

	it("replaces a displayed entity without retaining its source suffix", () => {
		expect(patchMarkdownSource("A &amp; B\n", "A & B\n", "A plus B\n")).toBe(
			"A plus B\n",
		);
	});
	it("deletes a rich line break without leaving an orphan carriage return", () => {
		expect(patchMarkdownSource("A\r\nB\r\n", "A\nB\n", "AB\n")).toBe("AB\r\n");
	});

	it("uses the original line ending when inserting a rich line break", () => {
		expect(patchMarkdownSource("AB\r\n", "AB\n", "A\nB\n")).toBe("A\r\nB\r\n");
	});
});

describe("cached source alignment", () => {
	it("keeps snapshots immutable and advances entities and CRLF spans across edits", () => {
		let source = "A &amp; B\r\nC &gt;\r\n";
		let rendered = "A & B\nC >\n";
		let spans = createMarkdownSourceMap(source, rendered);
		const original = structuredClone(spans);
		const first = patchMarkdownSourceWithMap(
			source,
			rendered,
			rendered.replace("A", "Alpha"),
			spans,
		);
		expect(spans).toEqual(original);
		source = first.content;
		spans = first.spans;
		rendered = rendered.replace("A", "Alpha");
		for (const next of [
			"Alpha & B\nC plus\n",
			"Alpha & B C plus\n",
			"Alpha & B\nC plus\n",
			"Alpha & B\nC plus!\n",
		]) {
			const expected = patchMarkdownSource(source, rendered, next);
			const patch = patchMarkdownSourceWithMap(source, rendered, next, spans);
			expect(patch.content).toBe(expected);
			source = patch.content;
			rendered = next;
			spans = patch.spans;
		}
		expect(source).toBe("Alpha &amp; B\r\nC plus!\r\n");
	});

	it.each([
		1000, 3000,
	])("preserves source spellings when patching %i divergent lines", (count) => {
		const baseline = Array.from(
			{ length: count },
			(_, index) =>
				`- Line ${index} with unchanged words and source spellings.\n`,
		).join("");
		for (const source of [
			baseline.replace(/\n/g, "\r\n"),
			baseline.replace(/^- /gm, "* "),
		]) {
			const spans = createMarkdownSourceMap(source, baseline);
			const next = baseline.replace("Line 500 ", "Changed 500 ");
			const durations: number[] = [];
			for (let run = 0; run < 5; run++) {
				const start = performance.now();
				const result = patchMarkdownSourceWithMap(
					source,
					baseline,
					next,
					spans,
				);
				durations.push(performance.now() - start);
				expect(result.content).toBe(
					source.replace("Line 500 ", "Changed 500 "),
				);
			}
			durations.sort((left, right) => left - right);
			// Coverage instrumentation and parallel workers distort wall-clock timings.
			// Enforce the frame budget in the dedicated, uninstrumented perf run.
			if (process.env.MEMORIA_PERF_TESTS === "1") {
				expect(durations[2]).toBeLessThanOrEqual(16);
			}
		}
	});

	it("reuses body alignment across property changes and invalidates changed paths or bodies", () => {
		const editor = {};
		const source = "A &amp; B\r\n";
		const rendered = "A & B\n";
		rememberRichEditorSource(editor, "/note.md", source, rendered);
		const frontmatter = "---\nstatus: done\n---\n";
		const baseline = readRichEditorSource(
			editor,
			"/note.md",
			frontmatter + source,
		);
		expect(baseline).toBeDefined();
		if (!baseline) throw new Error("Expected cached body alignment");
		expect(
			patchMarkdownSourceWithMap(
				frontmatter + source,
				baseline.rendered,
				`${frontmatter}Alpha & B\n`,
				baseline.spans,
			).content,
		).toBe(`${frontmatter}Alpha &amp; B\r\n`);
		expect(readRichEditorSource(editor, "/other.md", source)).toBeUndefined();
		expect(
			readRichEditorSource(editor, "/note.md", `${source}changed`),
		).toBeUndefined();
	});

	it("keeps cached and fresh alignments equivalent during edits and undo on an imported fixture", () => {
		let source = integrityMarkdown.replace(/\n/g, "\r\n");
		let rendered = renderedMarkdown;
		let spans = createMarkdownSourceMap(source, rendered);
		const edits = [
			rendered.replace("term", "terms"),
			rendered.replace("Inline code:", "Inline codes:"),
			rendered,
			`${rendered}Tail\n`,
			rendered,
		];
		for (const next of edits) {
			const expected = patchMarkdownSource(source, rendered, next);
			const patch = patchMarkdownSourceWithMap(source, rendered, next, spans);
			expect(patch.content).toBe(expected);
			source = patch.content;
			rendered = next;
			spans = patch.spans;
		}
		expect(source).toBe(integrityMarkdown.replace(/\n/g, "\r\n"));
	});

	it.runIf(process.env.MEMORIA_PERF_TESTS === "1")(
		"keeps a 6000-line canonical flush below five milliseconds",
		() => {
			const baseline = "Canonical unchanged text.\n".repeat(6000);
			const next = baseline.replace("text", "words");
			const durations: number[] = [];
			for (let run = 0; run < 5; run++) {
				const start = performance.now();
				expect(
					patchMarkdownSourceWithMap(baseline, baseline, next, []).content,
				).toBe(next);
				durations.push(performance.now() - start);
			}
			durations.sort((left, right) => left - right);
			expect(durations[2]).toBeLessThan(5);
		},
	);
});
