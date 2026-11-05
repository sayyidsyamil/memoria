import { useEffect, useMemo } from "react";
import { publishAiWorkspaceWindowSharedContext } from "../lib/aiWorkspaceWindowSharedContext";
import type {
	InboxPeriod,
	SidebarSelection,
	VaultEntry,
	ViewFile,
} from "../types";
import type { NoteListItem } from "../utils/ai-context";
import type { AllNotesFileVisibility } from "../utils/allNotesFileVisibility";
import { filterEntries, filterInboxEntries } from "../utils/noteListHelpers";
import type { AiWorkspaceWindowContext } from "../utils/openAiWorkspaceWindow";
import type { Tab } from "./useTabManagement";

interface UseAiWorkspacePublishedContextParams {
	activeTab: Tab | null;
	allNotesFileVisibility: AllNotesFileVisibility;
	context: AiWorkspaceWindowContext;
	effectiveSelection: SidebarSelection;
	entries: VaultEntry[];
	inboxPeriod: InboxPeriod;
	tabs: Tab[];
	views: ViewFile[];
}

export const AI_WORKSPACE_CONTEXT_PUBLISH_DELAY_MS = 300;

type NoteListFilter = {
	query: string;
	type: string | null;
};

function isInboxSelection(selection: SidebarSelection): boolean {
	return selection.kind === "filter" && selection.filter === "inbox";
}

function noteListItemsFromEntries(entries: VaultEntry[]): NoteListItem[] {
	return entries.map((entry) => ({
		path: entry.path,
		title: entry.title,
		type: entry.isA ?? "Note",
	}));
}

function noteListFilterForSelection(
	selection: SidebarSelection,
): NoteListFilter {
	if (selection.kind === "sectionGroup")
		return { type: selection.type, query: "" };
	if (selection.kind === "entity")
		return { type: null, query: selection.entry.title };
	return { type: null, query: "" };
}

function usePublishedNoteList({
	allNotesFileVisibility,
	effectiveSelection,
	entries,
	inboxPeriod,
	views,
}: Pick<
	UseAiWorkspacePublishedContextParams,
	| "allNotesFileVisibility"
	| "effectiveSelection"
	| "entries"
	| "inboxPeriod"
	| "views"
>): NoteListItem[] {
	return useMemo<NoteListItem[]>(() => {
		const filtered = isInboxSelection(effectiveSelection)
			? filterInboxEntries(entries, inboxPeriod)
			: filterEntries(entries, effectiveSelection, {
					views,
					allNotesFileVisibility,
				});
		return noteListItemsFromEntries(filtered);
	}, [allNotesFileVisibility, effectiveSelection, entries, inboxPeriod, views]);
}

export function useAiWorkspacePublishedContext(
	options: UseAiWorkspacePublishedContextParams,
) {
	const {
		activeTab,
		allNotesFileVisibility,
		context,
		effectiveSelection,
		entries,
		inboxPeriod,
		tabs,
		views,
	} = options;
	const inboxCount = useMemo(
		() => filterInboxEntries(entries, inboxPeriod).length,
		[entries, inboxPeriod],
	);

	const noteList = usePublishedNoteList({
		allNotesFileVisibility,
		effectiveSelection,
		entries,
		inboxPeriod,
		views,
	});

	const noteListFilter = useMemo(
		() => noteListFilterForSelection(effectiveSelection),
		[effectiveSelection],
	);

	// Publishing clones every entry and writes the JSON to localStorage synchronously,
	// and one edit cycle changes tabs, entries and the note list several times.
	useEffect(() => {
		const timer = setTimeout(() => {
			publishAiWorkspaceWindowSharedContext({
				...context,
				activeEntry: activeTab?.entry ?? null,
				activeNoteContent: activeTab?.content ?? null,
				entries,
				openTabs: tabs.map((tab) => tab.entry),
				noteList,
				noteListFilter,
			});
		}, AI_WORKSPACE_CONTEXT_PUBLISH_DELAY_MS);
		return () => clearTimeout(timer);
	}, [
		activeTab?.content,
		activeTab?.entry,
		context,
		entries,
		noteList,
		noteListFilter,
		tabs,
	]);

	return {
		inboxCount,
		noteList,
		noteListFilter,
	};
}
