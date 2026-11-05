import path from "node:path";
import {
	canonicalTypeInstanceKey,
	selectTypeInstanceDefaults,
} from "../src/utils/typeInstanceDefaults.mjs";
import * as vault from "./vault.js";

function typeField(frontmatter) {
	const fields = Object.entries(frontmatter);
	const canonical = fields.find(
		([key]) => canonicalTypeInstanceKey(key) === "type",
	);
	return (
		canonical?.[1] ??
		fields.find(([key]) => canonicalTypeInstanceKey(key) === "isa")?.[1]
	);
}

function typeTitle(note) {
	const heading = note.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
	return (
		heading ||
		note.frontmatter.title ||
		path.basename(note.path, ".md").replace(/-/g, " ")
	);
}

function defaultLines(frontmatter) {
	return selectTypeInstanceDefaults(Object.entries(frontmatter)).map(
		([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`,
	);
}

/** Structured MCP creation inherits defaults; full-content writes remain verbatim. */
export async function typeDefaultLines({ vaultPath, typeName }) {
	for (const filename of await vault.findMarkdownFiles(vaultPath)) {
		const note = await vault.getNote(
			vaultPath,
			path.relative(vaultPath, filename),
		);
		if (typeField(note.frontmatter) !== "Type") continue;
		if (typeTitle(note).toLowerCase() === typeName.toLowerCase())
			return defaultLines(note.frontmatter);
	}
	return [];
}
