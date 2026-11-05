import { describe, expect, it } from "vitest";
import { fileNameOf, isConflictCopyPath } from "./conflictCopyPaths";

describe("isConflictCopyPath", () => {
	it("recognizes the names the server gives conflict copies", () => {
		expect(isConflictCopyPath("welcome (conflict 2026-10-24 2210).md")).toBe(
			true,
		);
		expect(
			isConflictCopyPath("notes/plan (conflict 2026-10-24 2210 2).md"),
		).toBe(true);
		expect(isConflictCopyPath("README (conflict 2026-10-24 2210)")).toBe(true);
	});

	it("leaves ordinary notes alone, also ones that talk about conflicts", () => {
		expect(isConflictCopyPath("welcome.md")).toBe(false);
		expect(isConflictCopyPath("notes/conflict resolution.md")).toBe(false);
		expect(isConflictCopyPath("a (conflict) note.md")).toBe(false);
		expect(
			isConflictCopyPath("copies (conflict 2026-10-24 2210)/note.md"),
		).toBe(false);
	});
});

describe("fileNameOf", () => {
	it("drops the folders of a path", () => {
		expect(fileNameOf("notes/deep/plan.md")).toBe("plan.md");
		expect(fileNameOf("plan.md")).toBe("plan.md");
	});
});
