import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import type { RemoteBindings } from "../../packages/collab-client/src/remoteVaultBackend";
import { resolvePlatformCapabilities } from "../lib/platformCapabilities";
import type { VaultBackend, VaultCollabDoc } from "../lib/vaultBackend/types";
import {
	offlineCollabPath,
	useCollabEditorBinding,
} from "./collabEditorBinding";

type RemoteWindow = Window & {
	MEMORIA_REMOTE_URL?: string;
	MEMORIA_REMOTE_TOKEN?: string;
};

const web = resolvePlatformCapabilities("remote");
const tabs = ["a.md", "b.md"].map((path) => ({
	entry: { path, display: null, fileKind: "markdown" as const },
	content: "# Note\n",
}));

function createBackend() {
	const close = vi.fn();
	const openDoc = vi.fn(async (path: string) => {
		const doc = new Y.Doc();
		return {
			path,
			doc,
			awareness: new Awareness(doc),
			synced: Promise.resolve(),
			close,
		} as unknown as VaultCollabDoc<RemoteBindings>;
	});
	const backend = { collab: { openDoc } } as unknown as VaultBackend<RemoteBindings>;
	return { backend, openDoc, close };
}

function setNetwork(onLine: boolean): void {
	vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(onLine);
	act(() => {
		window.dispatchEvent(new Event(onLine ? "online" : "offline"));
	});
}

function renderBinding(backend: VaultBackend<RemoteBindings>, activeTabPath = "a.md") {
	return renderHook(
		({ path }) =>
			useCollabEditorBinding({
				tabs,
				activeTabPath: path,
				vaultBackend: backend,
				platformCapabilities: web,
			}),
		{ initialProps: { path: activeTabPath } },
	);
}

function useRemoteServer(): void {
	const remote = window as RemoteWindow;
	remote.MEMORIA_REMOTE_URL = "https://server.test";
	remote.MEMORIA_REMOTE_TOKEN = "token";
}

afterEach(() => {
	const remote = window as RemoteWindow;
	delete remote.MEMORIA_REMOTE_URL;
	delete remote.MEMORIA_REMOTE_TOKEN;
	vi.restoreAllMocks();
});

describe("offlineCollabPath", () => {
	it("opens any note online, and offline only the note already bound", () => {
		expect(offlineCollabPath("a.md", false, null)).toBe("a.md");
		expect(offlineCollabPath("a.md", true, "a.md")).toBe("a.md");
		expect(offlineCollabPath("a.md", true, null)).toBeNull();
		expect(offlineCollabPath("b.md", true, "a.md")).toBeNull();
		expect(offlineCollabPath(null, false, null)).toBeNull();
	});
});

describe("useCollabEditorBinding offline on the web (TOL-198)", () => {
	it("keeps a note opened offline on its cached markdown, then binds it once back online", async () => {
		useRemoteServer();
		vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
		const { backend, openDoc } = createBackend();
		const { result } = renderBinding(backend);

		expect(result.current).toEqual({ kind: "local" });
		expect(openDoc).not.toHaveBeenCalled();

		setNetwork(true);
		await waitFor(() => expect(result.current.kind).toBe("bound"));
		expect(openDoc).toHaveBeenCalledWith("a.md", { readOnly: false });
	});

	it("keeps the bound note's document when the network drops, and opens no other", async () => {
		useRemoteServer();
		vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
		const { backend, openDoc, close } = createBackend();
		const { result, rerender } = renderBinding(backend);
		await waitFor(() => expect(result.current.kind).toBe("bound"));

		setNetwork(false);
		expect(result.current.kind).toBe("bound");
		expect(close).not.toHaveBeenCalled();

		rerender({ path: "b.md" });
		expect(result.current).toEqual({ kind: "local" });
		expect(openDoc).toHaveBeenCalledTimes(1);
	});

	it("takes this window out of the bound note while offline, and puts it back online (TOL-17)", async () => {
		useRemoteServer();
		vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
		const { backend } = createBackend();
		const { result } = renderBinding(backend);
		await waitFor(() => expect(result.current.kind).toBe("bound"));
		const binding = result.current;
		if (binding.kind !== "bound") throw new Error("not bound");
		const awareness = binding.doc.awareness;
		expect(awareness.getLocalState()?.user).toEqual(
			expect.objectContaining({ name: expect.any(String) }),
		);

		setNetwork(false);
		expect(awareness.getLocalState()).toBeNull();

		setNetwork(true);
		expect(awareness.getLocalState()?.user).toEqual(
			expect.objectContaining({ name: expect.any(String) }),
		);
	});
});
