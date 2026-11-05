import { afterEach, describe, expect, it, vi } from "vitest";
import {
	isRemoteBrowserShell,
	isSyncPillBusy,
	isSyncPillReadOnly,
	resolveSyncPillState,
	type SyncPillInputs,
	syncPillDescription,
	syncPillLabel,
} from "./syncPillState";

const IDLE: SyncPillInputs = {
	collab: "synced",
	conflict: false,
	offline: false,
	reloading: false,
};

describe("resolveSyncPillState", () => {
	it.each<[string, Partial<SyncPillInputs>, string]>([
		["a synced document", {}, "synced"],
		["no document and nothing loading", { collab: null }, "synced"],
		["a document being opened", { collab: "opening" }, "connecting"],
		["a connecting provider", { collab: "connecting" }, "connecting"],
		["a closed provider", { collab: "closed" }, "connecting"],
		["a syncing provider", { collab: "syncing" }, "syncing"],
		["a background vault reload", { collab: null, reloading: true }, "syncing"],
		["a disconnected provider", { collab: "offline" }, "offline"],
		["no network", { offline: true, reloading: true }, "offline"],
		["a conflict copy", { conflict: true, offline: true }, "conflict"],
	])("shows %s", (_case, inputs, expected) => {
		expect(resolveSyncPillState({ ...IDLE, ...inputs })).toBe(expected);
	});
});

describe("isSyncPillBusy", () => {
	it("spins only while connecting or syncing", () => {
		expect(isSyncPillBusy("connecting")).toBe(true);
		expect(isSyncPillBusy("syncing")).toBe(true);
		expect(isSyncPillBusy("synced")).toBe(false);
		expect(isSyncPillBusy("offline")).toBe(false);
		expect(isSyncPillBusy("conflict")).toBe(false);
	});
});

describe("syncPillLabel", () => {
	it("says the vault is read-only while the browser is offline", () => {
		expect(isSyncPillReadOnly("offline", true)).toBe(true);
		expect(syncPillLabel("offline", true)).toBe("status.offline.readOnlyLabel");
	});

	it("names the state otherwise", () => {
		expect(isSyncPillReadOnly("offline", false)).toBe(false);
		expect(syncPillLabel("offline", false)).toBe("status.offline.label");
		expect(syncPillLabel("conflict", true)).toBe("status.sync.conflict");
	});
});

describe("syncPillDescription", () => {
	it("explains what is offline", () => {
		expect(syncPillDescription("offline", true)).toBe(
			"status.offline.readOnlyTitle",
		);
		expect(syncPillDescription("offline", false)).toBe("collab.status.offline");
	});

	it("describes the other states", () => {
		expect(syncPillDescription("conflict", false)).toBe("collab.conflictCopy");
		expect(syncPillDescription("synced", false)).toBe("collab.status.synced");
		expect(syncPillDescription("syncing", false)).toBe("collab.status.syncing");
	});
});

describe("isRemoteBrowserShell", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("is the browser build configured for a Memoria server", () => {
		expect(isRemoteBrowserShell()).toBe(false);
		vi.stubGlobal("MEMORIA_REMOTE_URL", "https://example.com");
		vi.stubGlobal("MEMORIA_REMOTE_TOKEN", "token");
		expect(isRemoteBrowserShell()).toBe(true);
	});
});
