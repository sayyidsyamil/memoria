type WikilinkTarget = string;

const MAX_SNIPPET_LENGTH = 160;

export function deriveTitle({
	body,
	fallbackTitle,
	filename,
}: {
	body: string;
	fallbackTitle: string | null;
	filename: string;
}): string {
	return firstH1Title(body) ?? fallbackTitle ?? humanizeFilename(filename);
}

export function extractSnippet(body: string): string {
	const lines: string[] = [];
	let fenceMarker: string | null = null;

	for (const line of body.split(/\r?\n/)) {
		const nextFence = nextMarkdownFenceMarker(line, fenceMarker);
		const inFence = fenceMarker !== null || nextFence !== fenceMarker;
		fenceMarker = nextFence;

		if (inFence) continue;
		if (!isSnippetLine(line)) continue;

		lines.push(stripListMarker(line));
	}

	const text = lines.join(" ");
	return truncateSnippet(stripMarkdown(text));
}

export function extractOutgoingLinks(body: string): WikilinkTarget[] {
	const links: WikilinkTarget[] = [];
	const wikilinkPattern = /\[\[([^\]]+)\]\]/g;
	let fenceMarker: string | null = null;

	scanMarkdownLines(body, (line) => {
		const nextFenceMarker = nextMarkdownFenceMarker(line, fenceMarker);
		const shouldSkip = fenceMarker !== null || nextFenceMarker !== fenceMarker;
		fenceMarker = nextFenceMarker;
		if (shouldSkip) return undefined;

		wikilinkPattern.lastIndex = 0;
		let match = wikilinkPattern.exec(line);
		while (match) {
			const parsed = parseWikilink(match[0]);
			if (parsed?.target) links.push(parsed.target);
			match = wikilinkPattern.exec(line);
		}
		return undefined;
	});

	return [...new Set(links)].sort();
}

export function hasH1(body: string): boolean {
	return firstH1Title(body) !== null;
}

export function countWords(body: string): number {
	let text = stripH1(body);
	text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, "");
	text = text.replace(/[#*_`>~|[\]-]/g, "");
	const words = text.match(/[\p{L}\p{N}]['\u2019\p{L}\p{N}]*/gu);
	return words ? words.length : 0;
}

function firstH1Title(body: string): string | null {
	return scanMarkdownLines(body, (line) => {
		const match = line.match(/^#\s+(.+)/);
		return match ? match[1].trim() : undefined;
	});
}

function stripH1(body: string): string {
	const lines = body.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].match(/^#\s+/)) {
			return lines.slice(i + 1).join("\n");
		}
	}
	return body;
}

function humanizeFilename(filename: string): string {
	return filename
		.replace(/\.[^.]+$/, "")
		.replace(/[-_]/g, " ")
		.replace(/\b\w/g, (char) => char.toUpperCase());
}

function scanMarkdownLines<T>(
	body: string,
	scanner: (line: string) => T | undefined,
): T | null {
	for (const line of body.split(/\r?\n/)) {
		const result = scanner(line);
		if (result !== undefined) return result;
	}
	return null;
}

function isSnippetLine(line: string): boolean {
	const trimmed = line.trim();
	return (
		trimmed.length > 0 &&
		!trimmed.startsWith("#") &&
		!trimmed.startsWith("```") &&
		!trimmed.startsWith("---")
	);
}

function stripListMarker(line: string): string {
	const trimmedStart = line.trimStart();

	if (trimmedStart.startsWith("- ")) return trimmedStart.slice(2);
	if (trimmedStart.startsWith("* ")) return trimmedStart.slice(2);
	if (trimmedStart.startsWith("+ ")) return trimmedStart.slice(2);

	const orderedMatch = trimmedStart.match(/^\d+[.)]\s/);
	if (orderedMatch) return trimmedStart.slice(orderedMatch[0].length);

	return trimmedStart;
}

function stripMarkdown(text: string): string {
	return text
		.replace(
			/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
			(_, target, display) => display || target,
		)
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/[*_`~]/g, "")
		.replace(/^#+\s+/gm, "")
		.trim();
}

function truncateSnippet(text: string): string {
	const encoder = new TextEncoder();
	const bytes = encoder.encode(text);

	if (bytes.length <= MAX_SNIPPET_LENGTH) return text;

	let truncated = new TextDecoder().decode(bytes.slice(0, MAX_SNIPPET_LENGTH));

	while (truncated.length > 0 && truncated[truncated.length - 1] === "\uFFFD") {
		truncated = truncated.slice(0, -1);
	}

	return `${truncated}...`;
}

function nextMarkdownFenceMarker(
	line: string,
	currentMarker: string | null,
): string | null {
	const match = line.match(/^(`{3,}|~{3,})/);
	if (!match) return currentMarker;

	const marker = match[1];
	if (currentMarker === null) return marker;
	if (currentMarker[0] === marker[0] && marker.length >= currentMarker.length)
		return null;
	return currentMarker;
}

function parseWikilink(
	value: string,
): { display: string; target: WikilinkTarget } | null {
	const match = value.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
	if (!match) return null;

	const target = match[1].trim();
	return { display: (match[2] ?? target).trim(), target };
}
