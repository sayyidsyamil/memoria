import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SidebarSelection } from "../types";
import { DEFAULT_ALL_NOTES_FILE_VISIBILITY } from "../utils/allNotesFileVisibility";
import { normalizeVaultEntry } from "../utils/vaultMetadataNormalization";
import type { Tab } from "./useTabManagement";

const publishMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/aiWorkspaceWindowSharedContext", () => ({
	publishAiWorkspaceWindowSharedContext: publishMock,
}));

import {
	AI_WORKSPACE_CONTEXT_PUBLISH_DELAY_MS,
	useAiWorkspacePublishedContext,
} from "./useAiWorkspacePublishedContext";

const entry = normalizeVaultEntry({
	path: "/vault/note.md",
	title: "Note",
	isA: "Note",
});
const selection: SidebarSelection = { kind: "filter", filter: "all" };
const context = { vaultPath: "/vault" };

function tabWithContent(content: string): Tab {
	return { entry, content };
}

function renderPublishedContext(content: string) {
	return renderHook(
		({ tab }: { tab: Tab }) =>
			useAiWorkspacePublishedContext({
				activeTab: tab,
				allNotesFileVisibility: DEFAULT_ALL_NOTES_FILE_VISIBILITY,
				context,
				effectiveSelection: selection,
				entries: [entry],
				inboxPeriod: "all",
				tabs: [tab],
				views: [],
			}),
		{ initialProps: { tab: tabWithContent(content) } },
	);
}

describe("useAiWorkspacePublishedContext", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		publishMock.mockClear();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("coalesces a burst of editor flushes into one cross-window publish", () => {
		const { rerender } = renderPublishedContext("# Note\n\na");
		rerender({ tab: tabWithContent("# Note\n\nab") });
		rerender({ tab: tabWithContent("# Note\n\nabc") });

		expect(publishMock).not.toHaveBeenCalled();

		vi.advanceTimersByTime(AI_WORKSPACE_CONTEXT_PUBLISH_DELAY_MS);

		expect(publishMock).toHaveBeenCalledTimes(1);
		expect(publishMock.mock.calls[0][0]).toMatchObject({
			activeNoteContent: "# Note\n\nabc",
			vaultPath: "/vault",
		});
	});

	it("drops a pending publish when the window unmounts", () => {
		const { unmount } = renderPublishedContext("# Note");
		unmount();

		vi.advanceTimersByTime(AI_WORKSPACE_CONTEXT_PUBLISH_DELAY_MS);

		expect(publishMock).not.toHaveBeenCalled();
	});
});
