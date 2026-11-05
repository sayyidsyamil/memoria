import { useEffect, useRef } from "react";
import type { SidebarSelection, VaultEntry } from "../../types";

interface DeletionFocusOptions {
	entries: VaultEntry[];
	visible: VaultEntry[];
	selection: SidebarSelection;
	loading: boolean;
	openNote: (entry: VaultEntry) => void;
	focusList: () => void;
}

interface ListSnapshot {
	available: Set<string>;
	visible: VaultEntry[];
	selection: SidebarSelection;
}

function replacementAfterRemoval(
	previous: ListSnapshot,
	options: DeletionFocusOptions,
): VaultEntry | undefined {
	if (options.loading || previous.selection !== options.selection) return;
	const available = new Set(options.entries.map((entry) => entry.path));
	const removedIndex = previous.visible.findIndex(
		(entry) => previous.available.has(entry.path) && !available.has(entry.path),
	);
	if (removedIndex < 0) return;
	// A replacement path belongs to creation/rename selection, not deletion.
	if (options.entries.some((entry) => !previous.available.has(entry.path)))
		return;

	const visible = new Map(options.visible.map((entry) => [entry.path, entry]));
	const candidates = [
		...previous.visible.slice(removedIndex + 1),
		...previous.visible.slice(0, removedIndex).reverse(),
	];
	const replacement = candidates.find(
		(entry) => visible.has(entry.path) && available.has(entry.path),
	);
	return replacement ? visible.get(replacement.path) : undefined;
}

export function useNoteListDeletionFocus({
	entries, visible, selection, loading, openNote, focusList,
}: DeletionFocusOptions): void {
	const previous = useRef<ListSnapshot | null>(null);
	const focusFrame = useRef<number | null>(null);

	useEffect(
		() => () => {
			if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
		},
		[],
	);

	useEffect(() => {
		const replacement = previous.current
			? replacementAfterRemoval(previous.current, { entries, visible, selection, loading, openNote, focusList })
			: undefined;
		previous.current = {
			available: new Set(entries.map((entry) => entry.path)),
			visible: visible,
			selection: selection,
		};
		if (!replacement) return;

		openNote(replacement);
		if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
		focusFrame.current = requestAnimationFrame(focusList);
	}, [entries, visible, selection, loading, openNote, focusList]);
}
