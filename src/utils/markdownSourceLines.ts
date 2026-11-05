type MarkdownSource = string;

export interface MarkdownSourceLine {
	content: string;
	newline: string;
}

export function isBlankMarkdownSourceLine(line: MarkdownSourceLine): boolean {
	return line.content.trim() === "";
}

export function splitMarkdownSourceLines(
	markdown: MarkdownSource,
): MarkdownSourceLine[] {
	const lines: MarkdownSourceLine[] = [];
	const lineRe = /([^\r\n]*)(\r\n|\n|$)/gu;

	for (;;) {
		const match = lineRe.exec(markdown);
		if (!match) break;

		const [rawLine, content = "", newline = ""] = match;
		if (rawLine === "" && match.index === markdown.length) break;

		lines.push({ content, newline });
		if (newline === "") break;
	}

	return lines;
}

export function markdownSourceLineText(line: MarkdownSourceLine): string {
	return `${line.content}${line.newline}`;
}
