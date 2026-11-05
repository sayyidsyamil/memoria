// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { workspaceScenarios } from "../fixtures/workspaceFixtures";
import type { ReadOnlyWorkspaceRepository } from "../workspace/readOnlyWorkspaceRepository";
import { useMobileNoteRead } from "./useMobileNoteRead";

let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
	if (root) await act(async () => root?.unmount());
	vi.useRealTimers();
});

it("keeps the original read deadline when the selected note object is refreshed", async () => {
	vi.useFakeTimers();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const host = document.createElement("div");
	root = createRoot(host);
	const note = {
		...workspaceScenarios.default.notes[0],
		rawContent: undefined,
	};
	const repository: ReadOnlyWorkspaceRepository = {
		persistWrites: vi.fn(async () => {}),
		readNoteContent: vi.fn(() => new Promise<string | null>(() => {})),
		readSnapshot: vi.fn(() => workspaceScenarios.default),
	};
	const request = {
		source: "native" as const,
		vaultRootUri: "file:///fixture",
	};
	let state: ReturnType<typeof useMobileNoteRead> | undefined;
	function Probe({ selectedNote }: { selectedNote: typeof note }) {
		const result = useMobileNoteRead({
			applyEdit: vi.fn(),
			note: selectedNote,
			repository,
			request,
		});
		useEffect(() => {
			state = result;
		}, [result]);
		return null;
	}

	await act(async () =>
		root?.render(createElement(Probe, { selectedNote: note })),
	);
	await act(async () => vi.advanceTimersByTimeAsync(9_000));
	await act(async () =>
		root?.render(
			createElement(Probe, {
				selectedNote: { ...note, title: "Refreshed title" },
			}),
		),
	);
	await act(async () => vi.advanceTimersByTimeAsync(1_000));

	expect(repository.readNoteContent).toHaveBeenCalledOnce();
	expect(state?.status).toBe("error");
});
