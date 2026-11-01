import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import type { RemoteBindings } from "../../packages/collab-client/src/remoteVaultBackend";
import { resolvePlatformCapabilities } from "../lib/platformCapabilities";
import {
	checkVaultAccess,
	resetVaultAccessForTests,
} from "../lib/sharing/vaultAccess";
import { applySharedVaultBase } from "../lib/vaultBackend/remoteConfig";
import type { VaultBackend, VaultCollabDoc } from "../lib/vaultBackend/types";
import {
	accessCollabPath,
	useCollabEditorBinding,
} from "./collabEditorBinding";

/** TOL-237: in a vault shared with the user, the live document follows what the share allows. */

type RemoteWindow = Window & {
	MEMORIA_REMOTE_URL?: string;
	MEMORIA_REMOTE_TOKEN?: string;
};

const web = resolvePlatformCapabilities("remote");
const tabs = [
	{
		entry: { path: "a.md", display: null, fileKind: "markdown" as const },
		content: "# Note\n",
	},
];

function createBackend() {
	const openDoc = vi.fn(async (path: string) => {
		const doc = new Y.Doc();
		return {
			path,
			doc,
			awareness: new Awareness(doc),
			synced: Promise.resolve(),
			close: vi.fn(),
		} as unknown as VaultCollabDoc<RemoteBindings>;
	});
	return {
		backend: { collab: { openDoc } } as unknown as VaultBackend<RemoteBindings>,
		openDoc,
	};
}

function openSharedVault(role: "viewer" | "editor"): void {
	window.history.replaceState(null, "", "/vaults/v_1/");
	Object.assign(window as RemoteWindow, {
		MEMORIA_REMOTE_URL: "https://front.test",
		MEMORIA_REMOTE_TOKEN: "via-front",
	});
	applySharedVaultBase();
	const access = { subject: "u_1", grants: [{ scope: "*", role }] };
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json({ access })),
	);
}

function renderBinding(backend: VaultBackend<RemoteBindings>) {
	return renderHook(() =>
		useCollabEditorBinding({
			tabs,
			activeTabPath: "a.md",
			vaultBackend: backend,
			platformCapabilities: web,
		}),
	);
}

afterEach(() => {
	const remote = window as RemoteWindow;
	delete remote.MEMORIA_REMOTE_URL;
	delete remote.MEMORIA_REMOTE_TOKEN;
	window.history.replaceState(null, "", "/");
	vi.unstubAllGlobals();
	resetVaultAccessForTests();
});

describe("accessCollabPath", () => {
	it("opens nothing while the access is checked or after it was revoked", () => {
		expect(accessCollabPath("a.md", { kind: "owner" })).toBe("a.md");
		expect(accessCollabPath("a.md", { kind: "checking" })).toBeNull();
		expect(accessCollabPath("a.md", { kind: "revoked" })).toBeNull();
		expect(
			accessCollabPath("a.md", {
				kind: "shared",
				access: { subject: "u_1", grants: [{ scope: "*", role: "viewer" }] },
			}),
		).toBe("a.md");
	});
});

describe("useCollabEditorBinding in a shared vault", () => {
	it.each([
		["viewer", true],
		["editor", false],
	] as const)("waits for the access, then joins as a %s", async (role, readOnly) => {
		openSharedVault(role);
		const { backend, openDoc } = createBackend();
		const { result } = renderBinding(backend);

		expect(result.current).toEqual({ kind: "local" });
		await act(() => checkVaultAccess());

		await waitFor(() => expect(result.current.kind).toBe("bound"));
		expect(openDoc).toHaveBeenCalledTimes(1);
		expect(openDoc).toHaveBeenCalledWith("a.md", { readOnly });
	});
});
