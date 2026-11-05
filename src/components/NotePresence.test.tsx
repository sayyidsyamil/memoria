import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	applyAwarenessUpdate,
	Awareness,
	encodeAwarenessUpdate,
	removeAwarenessStates,
} from "y-protocols/awareness";
import * as Y from "yjs";
import type { RemoteBindings } from "../../packages/collab-client/src/remoteVaultBackend";
import { publishActiveCollabDocument } from "../lib/activeCollabDocument";
import type { VaultCollabDoc } from "../lib/vaultBackend/types";
import { NotePresence } from "./NotePresence";

let withdraw: (() => void) | null = null;

afterEach(() => {
	act(() => withdraw?.());
	withdraw = null;
});

function liveDocument(): VaultCollabDoc<RemoteBindings> {
	const doc = new Y.Doc();
	const awareness = new Awareness(doc);
	awareness.setLocalState({ user: { name: "Chrome · Mac", color: "#1971c2" } });
	return {
		path: "a.md",
		doc,
		awareness,
	} as unknown as VaultCollabDoc<RemoteBindings>;
}

function open(document: VaultCollabDoc<RemoteBindings> | "opening") {
	act(() => {
		withdraw = publishActiveCollabDocument(document);
	});
}

/** Another window joins the note: its state arrives as it would from the server. */
function join(observer: Awareness, name: string): Awareness {
	const peer = new Awareness(new Y.Doc());
	peer.setLocalState({ user: { name, color: "#2f9e44" } });
	act(() => {
		applyAwarenessUpdate(
			observer,
			encodeAwarenessUpdate(peer, [peer.clientID]),
			"remote",
		);
	});
	return peer;
}

function leave(observer: Awareness, peer: Awareness) {
	act(() => {
		removeAwarenessStates(observer, [peer.clientID], "remote");
	});
}

describe("NotePresence", () => {
	it("shows nothing without a live note, or while it opens", () => {
		const { container } = render(<NotePresence />);
		open("opening");

		expect(container).toBeEmptyDOMElement();
	});

	it("shows nothing while the viewer is alone in the note", () => {
		open(liveDocument());
		const { container } = render(<NotePresence />);

		expect(container).toBeEmptyDOMElement();
	});

	it("shows the others as avatars, and drops one that leaves", () => {
		const document = liveDocument();
		open(document);
		render(<NotePresence />);

		const ada = join(document.awareness, "Ada Lovelace");
		join(document.awareness, "Safari · iPhone");
		const avatars = screen.getAllByTestId("note-presence-avatar");
		expect(avatars.map((avatar) => avatar.getAttribute("aria-label"))).toEqual([
			"Ada Lovelace",
			"Safari · iPhone",
		]);
		expect(avatars.map((avatar) => avatar.textContent)).toEqual(["AL", "SI"]);

		leave(document.awareness, ada);
		expect(screen.getAllByTestId("note-presence-avatar")).toHaveLength(1);
	});

	it("counts the people beyond three instead of crowding the bar", () => {
		const document = liveDocument();
		open(document);
		render(<NotePresence />);

		for (const name of ["A", "B", "C", "D", "E"])
			join(document.awareness, name);

		expect(screen.getAllByTestId("note-presence-avatar")).toHaveLength(3);
		expect(screen.getByTestId("note-presence")).toHaveTextContent("+2");
	});

	it("lists everyone by name on a tap, the viewer first", () => {
		const document = liveDocument();
		open(document);
		render(<NotePresence locale="en" />);
		join(document.awareness, "Safari · iPhone");

		fireEvent.click(
			screen.getByRole("button", { name: "People in this note" }),
		);

		const rows = screen
			.getByTestId("note-presence-list")
			.querySelectorAll("li");
		expect([...rows].map((row) => row.textContent)).toEqual([
			"CMChrome · Mac (you)",
			"SISafari · iPhone",
		]);
	});
});
