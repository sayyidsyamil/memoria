import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistContent } from "./useSaveNote";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../mock-tauri", () => ({ isTauri: () => true }));

describe("native note persistence", () => {
	beforeEach(() => vi.mocked(invoke).mockClear());

	it("sends embedded images as UTF-8 bytes instead of a JSON note payload", async () => {
		const content = `# Photo\n\n![photo](data:image/png;base64,${"A".repeat(8 * 1024 * 1024)})\n\nTyped after clicking the image — 日本語`;
		const path = "/vault/日本語 🖼.md";
		await persistContent(path, content);
		const [command, body, options] = vi.mocked(invoke).mock.calls[0];
		expect(command).toBe("save_note_content_bytes");
		expect(ArrayBuffer.isView(body)).toBe(true);
		expect(new TextDecoder().decode(body as Uint8Array)).toBe(content);
		const encodedPath = new TextEncoder().encode(path);
		expect(options).toEqual({
			headers: {
				"x-memoria-note-path": btoa(
					Array.from(encodedPath, (byte) => String.fromCharCode(byte)).join(""),
				),
			},
		});
	});

	it("keeps JSON serialization bounded at the small-note threshold", async () => {
		const content = "x".repeat(256 * 1024);
		await persistContent("/vault/note.md", content);
		expect(invoke).toHaveBeenLastCalledWith("save_note_content", {
			path: "/vault/note.md",
			content,
		});
		await persistContent("/vault/note.md", `${content}x`);
		expect(vi.mocked(invoke).mock.calls[1][0]).toBe("save_note_content_bytes");
	});

	it("propagates native save failures without retrying through JSON", async () => {
		vi.mocked(invoke).mockRejectedValueOnce(new Error("Disk full"));
		await expect(
			persistContent("/vault/note.md", "x".repeat(256 * 1024 + 1)),
		).rejects.toThrow("Disk full");
		expect(invoke).toHaveBeenCalledTimes(1);
		expect(vi.mocked(invoke).mock.calls[0][0]).toBe("save_note_content_bytes");
	});
});
