import { describe, expect, it } from "vitest";
import type { VaultEntry } from "../types";
import fixture from "../utils/typeInstanceDefaults.fixtures.json";
import { resolveTypeInstanceDefaults } from "./useNoteCreation";

describe("desktop Type instance defaults", () => {
	it("selects defaults from the shared MCP fixture", () => {
		const typeEntry = {
			isA: "Type",
			title: "Project",
			properties: Object.fromEntries(
				fixture.fields.filter(([key]) => key !== "Depends On"),
			),
			relationships: {
				"Depends On": ["[[Roadmap]]", "[[Plan]]"],
			},
		} as unknown as VaultEntry;

		const actual = resolveTypeInstanceDefaults({
			entries: [typeEntry],
			typeName: "Project",
		});

		expect(actual).toEqual(
			fixture.expected.map(([key, value]) => ({
				key,
				value,
				kind: key === "Depends On" ? "relationship" : "property",
			})),
		);
	});
});
