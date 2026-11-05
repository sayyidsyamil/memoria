import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as tools from "./tool-service.js";
import * as vault from "./vault.js";

for (const key of ["Status", "status"]) {
	test(`structured creation inherits ${key} without Type display fields`, async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "memoria-defaults-"));
		try {
			await fs.writeFile(
				path.join(root, "project.md"),
				`---\ntype: Type\n${key}: Active\nBudget:\ncolor: red\nsidebar label: Projects\n_icon: rocket\n_order: 2\nvisible: true\ntemplate: Body\n---\n# Project\n`,
			);
			const service = tools.createMcpToolService({
				resolveVaultPaths: () => [root],
			});
			await service.createNote({ path: "first.md", type: "Project" });
			const first = await vault.getNote(root, "first.md");
			assert.deepEqual(first.frontmatter, { type: "Project", [key]: "Active" });
			const original = await fs.readFile(path.join(root, "first.md"), "utf8");
			await fs.writeFile(
				path.join(root, "project.md"),
				`---\ntype: Type\n${key}: Planned\n---\n# Project\n`,
			);
			await service.createNote({ path: "second.md", is_a: "Project" });
			assert.equal(
				(await vault.getNote(root, "second.md")).frontmatter[key],
				"Planned",
			);
			assert.equal(
				await fs.readFile(path.join(root, "first.md"), "utf8"),
				original,
			);
			const explicit = "---\ntype: Project\nStatus: Done\n---\n# Explicit\n";
			await service.createNote({
				path: "explicit.md",
				type: "Project",
				content: explicit,
			});
			assert.equal(
				await fs.readFile(path.join(root, "explicit.md"), "utf8"),
				explicit,
			);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});
}

test("structured MCP creation matches the desktop Type fixture", async () => {
	const fixturePath = new URL(
		"../src/utils/typeInstanceDefaults.fixtures.json",
		import.meta.url,
	);
	const fixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "memoria-parity-"));
	try {
		const fields = fixture.fields
			.map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`)
			.join("\n");
		await fs.writeFile(
			path.join(root, "project.md"),
			`---\ntype: Type\n${fields}\n---\n# Project\n`,
		);
		const service = tools.createMcpToolService({
			resolveVaultPaths: () => [root],
		});
		await service.createNote({ path: "project-instance.md", type: "Project" });
		const actual = await vault.getNote(root, "project-instance.md");
		assert.deepEqual(
			Object.entries(actual.frontmatter).filter(([key]) => key !== "type"),
			fixture.expected,
		);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});
