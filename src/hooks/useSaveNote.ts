import { invoke } from "@tauri-apps/api/core";
import { useCallback } from "react";
import { isTauri, mockInvoke, updateMockContent } from "../mock-tauri";
import { cacheNoteContent } from "./useTabManagement";

const MAX_JSON_NOTE_CHARS = 256 * 1024;

export async function persistContent(
	path: string,
	content: string,
): Promise<void> {
	if (isTauri() && content.length > MAX_JSON_NOTE_CHARS) {
		const encoder = new TextEncoder();
		const encodedPath = btoa(
			Array.from(encoder.encode(path), (byte) =>
				String.fromCharCode(byte),
			).join(""),
		);
		await invoke("save_note_content_bytes", encoder.encode(content), {
			headers: { "x-memoria-note-path": encodedPath },
		});
	} else if (isTauri()) {
		await invoke("save_note_content", { path, content });
	} else {
		await mockInvoke("save_note_content", { path, content });
	}
}

/**
 * Hook that provides an explicit save function for note content.
 * Called on Cmd+S — no debounce, no auto-save.
 *
 * @param updateContent - callback to also update in-memory state after save
 */
export function useSaveNote(
	updateContent: (path: string, content: string) => void,
) {
	const saveNote = useCallback(
		async (path: string, content: string) => {
			await persistContent(path, content);
			cacheNoteContent(path, content);
			if (!isTauri()) {
				updateMockContent(path, content);
			}
			updateContent(path, content);
		},
		[updateContent],
	);

	return { saveNote };
}
