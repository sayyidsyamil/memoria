import { describe, expect, it } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { announcePresence } from "./useLocalPresence";

const USER = { name: "Safari · iPhone", color: "#1971c2" };

function awareness(): Awareness {
	return new Awareness(new Y.Doc());
}

describe("announcePresence", () => {
	it("adds the user to the state online, keeping the caret", () => {
		const local = awareness();
		local.setLocalState({ cursor: { anchor: 1 } });

		announcePresence(local, USER, true);

		expect(local.getLocalState()).toEqual({
			cursor: { anchor: 1 },
			user: USER,
		});
	});

	it("withdraws offline, and comes back with the user alone", () => {
		const local = awareness();
		local.setLocalState({ cursor: { anchor: 1 }, user: USER });

		announcePresence(local, USER, false);
		const offline = local.getLocalState();
		announcePresence(local, USER, false);
		announcePresence(local, USER, true);

		expect([offline, local.getLocalState()]).toEqual([null, { user: USER }]);
	});
});
