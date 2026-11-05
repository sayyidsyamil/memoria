import { describe, expect, it, vi } from "vitest";
import type { RemoteBindings } from "../../packages/collab-client/src/remoteVaultBackend";
import {
	getActiveCollabDocument,
	publishActiveCollabDocument,
	subscribeActiveCollabDocument,
} from "./activeCollabDocument";
import type { VaultCollabDoc } from "./vaultBackend/types";

function fakeDocument(path: string): VaultCollabDoc<RemoteBindings> {
	return { path } as VaultCollabDoc<RemoteBindings>;
}

describe("active collab document", () => {
	it("tells subscribers when a document is published and withdrawn", () => {
		const listener = vi.fn();
		const stop = subscribeActiveCollabDocument(listener);
		const document = fakeDocument("a.md");

		const withdraw = publishActiveCollabDocument(document);
		expect(getActiveCollabDocument()).toBe(document);
		withdraw();
		expect(getActiveCollabDocument()).toBeNull();
		expect(listener).toHaveBeenCalledTimes(2);

		stop();
		publishActiveCollabDocument("opening")();
		expect(listener).toHaveBeenCalledTimes(2);
	});

	it("leaves a newer document alone when an older one is withdrawn", () => {
		const withdrawOlder = publishActiveCollabDocument(fakeDocument("a.md"));
		const newer = fakeDocument("b.md");
		const withdrawNewer = publishActiveCollabDocument(newer);

		withdrawOlder();
		expect(getActiveCollabDocument()).toBe(newer);
		withdrawNewer();
		expect(getActiveCollabDocument()).toBeNull();
	});
});
