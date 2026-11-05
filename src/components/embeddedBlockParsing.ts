import type { DurableBlockCodec } from "../utils/durableMarkdownBlocks";
import { htmlBlockMarkdownCodec as embeddedCodec } from "../utils/htmlBlockMarkdown";

interface EmbeddedPayload {
	height: string;
	html: string;
}

function codeLanguage(element: Element): string | undefined {
	const declared = element.getAttribute("data-language");
	const classLanguage = Array.from(element.classList)
		.find((value) => value.startsWith("language-"))
		?.slice(9);
	return (declared ?? classLanguage)?.trim().split(/\s+/u)[0]?.toLowerCase();
}

function embeddedCodeElement(element: HTMLElement): Element | null {
	if (element.tagName !== "PRE") return null;
	if (element.childElementCount !== 1) return null;
	const code = element.firstElementChild;
	return code?.tagName === "CODE" ? code : null;
}

type CodeBlockCodec = Pick<DurableBlockCodec, "readCodeBlock">;

export function readCodecPreElement<T>(
	element: HTMLElement,
	{ language, codec }: { language: string; codec: CodeBlockCodec },
): T | undefined {
	const code = embeddedCodeElement(element);
	if (!code || codeLanguage(code) !== language) return undefined;
	const source = code.textContent ?? "";
	const payload = codec.readCodeBlock?.({
		type: "codeBlock",
		props: { language },
		content: [
			{ type: "text", text: source.endsWith("\n") ? source : `${source}\n` },
		],
	});
	return payload ? (payload as T) : undefined;
}

export function readEmbeddedPreElement(
	element: HTMLElement,
): EmbeddedPayload | undefined {
	return readCodecPreElement<EmbeddedPayload>(element, {
		language: "html",
		codec: embeddedCodec,
	});
}
