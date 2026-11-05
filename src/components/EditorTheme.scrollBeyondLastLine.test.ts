import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const editorThemeCss = readFileSync("src/components/EditorTheme.css", "utf8");
const editorCss = readFileSync("src/components/Editor.css", "utf8");

describe("rich editor scroll-beyond-last-line space", () => {
	it("reserves half of the viewport after the BlockNote document", () => {
		expect(editorThemeCss).toMatch(
			/\.editor__blocknote-container \.bn-editor\s*\{[^}]*padding-bottom:\s*max\(var\(--editor-padding-vertical\),\s*50vh\)/s,
		);
	});

	it("removes print spacing even after the export-mode timer expires", () => {
		expect(editorCss).toMatch(
			/body:has\(\[data-note-pdf-export-root="true"\]\) \.bn-editor\s*\{[^}]*padding:\s*0;/s,
		);
	});
});
