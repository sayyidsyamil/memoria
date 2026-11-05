import { type MarkdownTextEdit, markdownTextEdits } from "./markdownTextDiff";

type MarkdownSource = string;
type RenderedMarkdown = string;
type TextOffset = number;

export interface SourceSpan {
	sourceFrom: number;
	sourceTo: number;
	renderedFrom: number;
	renderedTo: number;
}

export function createMarkdownSourceMap(
	source: MarkdownSource,
	rendered: RenderedMarkdown,
): SourceSpan[] {
	let offset = 0;
	const spans = alignmentEdits(source, rendered).map((edit) => {
		const renderedFrom = edit.from + offset;
		offset += edit.insert.length - (edit.to - edit.from);
		return {
			sourceFrom: edit.from,
			sourceTo: edit.to,
			renderedFrom,
			renderedTo: renderedFrom + edit.insert.length,
		};
	});
	return protectSourceTokenSpans(source, spans);
}

function alignmentEdits(
	source: MarkdownSource,
	rendered: RenderedMarkdown,
): MarkdownTextEdit[] {
	if (source === rendered) return [];
	const sourceLines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
	const renderedLines = rendered.match(/[^\n]*\n|[^\n]+$/g) ?? [];
	if (sourceLines.length !== renderedLines.length)
		return markdownTextEdits(source, rendered);
	let offset = 0;
	const edits: MarkdownTextEdit[] = [];
	for (const [index, line] of sourceLines.entries()) {
		for (const edit of lineAlignmentEdits(
			line,
			renderedLines.at(index) ?? "",
		)) {
			edits.push({ ...edit, from: edit.from + offset, to: edit.to + offset });
		}
		offset += line.length;
	}
	return edits;
}

function lineAlignmentEdits(
	source: MarkdownSource,
	rendered: RenderedMarkdown,
): MarkdownTextEdit[] {
	const sourceEnding = source.match(/\r?\n$/)?.[0] ?? "";
	const renderedEnding = rendered.match(/\r?\n$/)?.[0] ?? "";
	const sourceBody = source.slice(0, source.length - sourceEnding.length);
	const renderedBody = rendered.slice(
		0,
		rendered.length - renderedEnding.length,
	);
	const edits = markdownTextEdits(sourceBody, renderedBody);
	for (const edit of markdownTextEdits(sourceEnding, renderedEnding)) {
		edits.push({
			...edit,
			from: edit.from + sourceBody.length,
			to: edit.to + sourceBody.length,
		});
	}
	return edits;
}

function spanStartsBefore(
	span: SourceSpan | undefined,
	position: TextOffset,
): boolean {
	return span !== undefined && span.sourceFrom < position;
}

function tokenContainsSpan(
	span: SourceSpan | undefined,
	end: TextOffset,
): span is SourceSpan {
	if (!span) return false;
	return span.sourceFrom <= end && span.sourceTo <= end;
}

function protectSourceTokenSpans(
	source: MarkdownSource,
	spans: SourceSpan[],
): SourceSpan[] {
	const result: SourceSpan[] = [];
	let index = 0;
	for (const match of source.matchAll(
		/&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);|\r\n/giu,
	)) {
		const from = match.index;
		const to = from + match[0].length;
		while (spanStartsBefore(spans.at(index), from)) {
			result.push(...spans.slice(index, index + 1));
			index++;
		}
		const first = spans.at(index);
		if (!tokenContainsSpan(first, to)) continue;
		const offset = first.renderedFrom - first.sourceFrom;
		let last = first;
		while (tokenContainsSpan(spans.at(index), to)) {
			last = spans.at(index++) ?? first;
		}
		result.push({
			sourceFrom: from,
			sourceTo: to,
			renderedFrom: from + offset,
			renderedTo: to + last.renderedTo - last.sourceTo,
		});
	}
	result.push(...spans.slice(index));
	return result;
}

function sourcePosition(
	spans: SourceSpan[],
	position: TextOffset,
	affinity: "before" | "after",
): number {
	let offset = 0;
	for (const span of spans) {
		if (position < span.renderedFrom) break;
		if (position <= span.renderedTo) {
			if (span.renderedFrom !== span.renderedTo) {
				if (position === span.renderedFrom) return span.sourceFrom;
				if (position === span.renderedTo) return span.sourceTo;
			}
			return affinity === "before" ? span.sourceFrom : span.sourceTo;
		}
		offset = span.sourceTo - span.renderedTo;
	}
	return position + offset;
}

function sourceEdit(
	spans: SourceSpan[],
	edit: MarkdownTextEdit,
): MarkdownTextEdit {
	const from = sourcePosition(spans, edit.from, "after");
	const to =
		edit.from === edit.to ? from : sourcePosition(spans, edit.to, "before");
	return { from, to: Math.max(from, to), insert: edit.insert };
}

interface SourcePatch {
	content: string;
	spans: SourceSpan[];
}

function shiftSpan(
	span: SourceSpan,
	sourceDelta: TextOffset,
	renderedDelta: TextOffset,
): SourceSpan {
	return {
		sourceFrom: span.sourceFrom + sourceDelta,
		sourceTo: span.sourceTo + sourceDelta,
		renderedFrom: span.renderedFrom + renderedDelta,
		renderedTo: span.renderedTo + renderedDelta,
	};
}

function updateSourceMap(
	{
		spans,
		content: source,
		rendered,
	}: SourcePatch & { rendered: RenderedMarkdown },
	edit: MarkdownTextEdit,
	mapped: MarkdownTextEdit,
): SourceSpan[] {
	const before: SourceSpan[] = [];
	const after: SourceSpan[] = [];
	let sourceFrom = mapped.from;
	let sourceTo = mapped.to;
	let renderedFrom = edit.from;
	let renderedTo = edit.to;
	const sourceDelta = mapped.insert.length - (mapped.to - mapped.from);
	const renderedDelta = edit.insert.length - (edit.to - edit.from);
	for (const span of spans) {
		if (span.renderedTo < edit.from) before.push(span);
		else if (span.renderedFrom > edit.to)
			after.push(shiftSpan(span, sourceDelta, renderedDelta));
		else {
			sourceFrom = Math.min(sourceFrom, span.sourceFrom);
			sourceTo = Math.max(sourceTo, span.sourceTo);
			renderedFrom = Math.min(renderedFrom, span.renderedFrom);
			renderedTo = Math.max(renderedTo, span.renderedTo);
		}
	}
	const sourceRegion =
		source.slice(sourceFrom, mapped.from) +
		mapped.insert +
		source.slice(mapped.to, sourceTo);
	const renderedRegion =
		rendered.slice(renderedFrom, edit.from) +
		edit.insert +
		rendered.slice(edit.to, renderedTo);
	const replacement = createMarkdownSourceMap(sourceRegion, renderedRegion).map(
		(span) => shiftSpan(span, sourceFrom, renderedFrom),
	);
	return [...before, ...replacement, ...after];
}

/** Apply rich changes and advance the cached alignment without diffing the whole source again. */
export function patchMarkdownSourceWithMap(
	source: MarkdownSource,
	renderedBefore: RenderedMarkdown,
	renderedAfter: RenderedMarkdown,
	sourceMap: SourceSpan[],
): SourcePatch {
	const edits = markdownTextEdits(renderedBefore, renderedAfter);
	let content = source;
	let rendered = renderedBefore;
	let spans = sourceMap;
	const separator = source.match(/\r\n|\r|\n/)?.[0] ?? "\n";
	for (const edit of [...edits].reverse()) {
		const mapped = sourceEdit(spans, edit);
		mapped.insert = mapped.insert.replace(/\n/g, separator);
		spans = updateSourceMap({ spans, content, rendered }, edit, mapped);
		content =
			content.slice(0, mapped.from) + mapped.insert + content.slice(mapped.to);
		rendered =
			rendered.slice(0, edit.from) + edit.insert + rendered.slice(edit.to);
	}
	return { content, spans };
}

/** Apply only rich-editor changes to the original file, retaining untouched source spellings. */
export function patchMarkdownSource(
	source: MarkdownSource,
	renderedBefore: RenderedMarkdown,
	renderedAfter: RenderedMarkdown,
): string {
	if (renderedBefore === renderedAfter) return source;
	return patchMarkdownSourceWithMap(
		source,
		renderedBefore,
		renderedAfter,
		createMarkdownSourceMap(source, renderedBefore),
	).content;
}
