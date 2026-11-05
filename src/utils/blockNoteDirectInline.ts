import {
	escapeInlineMarkdownText,
	wrapInlineMarkdown,
} from "./blockNoteMarkdownInline";

interface TextStyles {
	[style: string]: string | boolean | undefined;
}

export interface InlineItem {
	type?: string;
	text?: string;
	href?: string;
	props?: Record<string, string | undefined>;
	styles?: TextStyles;
	content?: InlineItem[];
	[key: string]: unknown;
}

const IMAGE_MARKER_BANG_RE = /!(?=\[)/g;
const LEADING_ATX_HEADING_RE = /^([ \t]{0,3})(#{1,6})(?=\s|$)/gm;
const LEADING_BLOCKQUOTE_RE = /^([ \t]{0,3})>/gm;
export function escapeText(text: string): string {
	return escapeInlineMarkdownText(text)
		.replace(IMAGE_MARKER_BANG_RE, "\\!")
		.replace(LEADING_ATX_HEADING_RE, "$1\\$2")
		.replace(LEADING_BLOCKQUOTE_RE, "$1\\>");
}

export function escapeLinkTarget(target: string): string {
	return target.includes(" ") || target.includes(")")
		? `<${target.replace(/>/g, "%3E")}>`
		: target;
}

function inlineText(item: InlineItem): string {
	switch (item.type) {
		case "text":
			return item.text ?? "";
		case "link":
			return linkMarkdown(item);
		case "wikilink":
			return wikilinkMarkdown(item);
		case "mathInline":
			return mathMarkdown(item);
		default:
			return serializeInlineContent(item.content);
	}
}

function mathMarkdown(item: InlineItem): string {
	return item.props?.latex ? `$${item.props.latex}$` : "";
}

function linkLabel(item: InlineItem): string {
	return escapeText(item.text ?? item.props?.title ?? item.props?.href ?? "");
}

function linkMarkdown(item: InlineItem): string {
	const content = Array.isArray(item.content)
		? serializeInlineContent(item.content)
		: linkLabel(item);
	const href = item.props?.href ?? item.href;
	return href ? `[${content}](${escapeLinkTarget(href)})` : content;
}

function wikilinkMarkdown(item: InlineItem): string {
	const target = item.props?.target;
	return target ? `[[${target}]]` : "";
}

function styledTextMarkdown(item: InlineItem): string {
	const source = item.text ?? "";
	const styles = item.styles ?? {};
	if (styles.code === true) return codeSpan(source);
	return applyInlineStyle(
		applyInlineStyle(
			applyInlineStyle(escapeText(source), styles.bold, "**"),
			styles.italic,
			"*",
		),
		styles.strike,
		"~~",
	);
}

function applyInlineStyle(
	text: string,
	enabled: string | boolean | undefined,
	marker: string,
): string {
	return enabled === true ? wrapInlineMarkdown(text, marker) : text;
}

function codeSpan(text: string): string {
	const marker = text.includes("`") ? "``" : "`";
	const needsPadding =
		marker === "``" && (text.startsWith("`") || text.endsWith("`"));
	return needsPadding
		? `${marker} ${text} ${marker}`
		: `${marker}${text}${marker}`;
}

export function serializeInlineItem(item: InlineItem): string {
	return item.type === "text" ? styledTextMarkdown(item) : inlineText(item);
}

export function serializeInlineContent(
	content: InlineItem[] | undefined,
): string {
	return content?.map(serializeInlineItem).join("") ?? "";
}

function literalInlineText(item: InlineItem): string {
	if (typeof item.text === "string") return item.text;
	if (Array.isArray(item.content)) return literalTextContent(item.content);
	return "";
}

export function literalTextContent(content: InlineItem[] | undefined): string {
	return content?.map(literalInlineText).join("") ?? "";
}
