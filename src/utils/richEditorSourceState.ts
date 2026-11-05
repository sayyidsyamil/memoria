import {
	createMarkdownSourceMap,
	type SourceSpan,
} from "./markdownSourcePatch";
import { splitFrontmatter } from "./wikilinks";

interface SourceSnapshot {
	source: string;
	rendered: string;
	spans: SourceSpan[];
}

const snapshots = new WeakMap<object, Map<string, SourceSnapshot>>();
const SNAPSHOT_LIMIT = 32;

export function rememberRichEditorSource(
	editor: object,
	path: string,
	source: string,
	rendered: string,
	spans = createMarkdownSourceMap(source, rendered),
): void {
	const states = snapshots.get(editor) ?? new Map<string, SourceSnapshot>();
	const key = sourceKey(path, source);
	states.delete(key);
	states.set(key, { source, rendered, spans });
	while (states.size > SNAPSHOT_LIMIT) {
		const oldest = states.keys().next().value;
		if (oldest === undefined) break;
		states.delete(oldest);
	}
	snapshots.set(editor, states);
}

export function readRichEditorSource(
	editor: object,
	path: string,
	source: string,
): SourceSnapshot | undefined {
	const snapshot = snapshots.get(editor)?.get(sourceKey(path, source));
	if (!snapshot) return undefined;
	const [frontmatter] = splitFrontmatter(source);
	const [, renderedBody] = splitFrontmatter(snapshot.rendered);
	const [previousFrontmatter] = splitFrontmatter(snapshot.source);
	const delta = frontmatter.length - previousFrontmatter.length;
	const spans =
		delta === 0
			? snapshot.spans
			: snapshot.spans.map((span) => ({
					sourceFrom: span.sourceFrom + delta,
					sourceTo: span.sourceTo + delta,
					renderedFrom: span.renderedFrom + delta,
					renderedTo: span.renderedTo + delta,
				}));
	return { source, rendered: `${frontmatter}${renderedBody}`, spans };
}

function sourceKey(path: string, source: string): string {
	const [, body] = splitFrontmatter(source);
	return `${path}\u0000${body}`;
}
