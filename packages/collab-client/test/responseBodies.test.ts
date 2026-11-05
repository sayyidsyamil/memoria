import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type MockInstance,
	vi,
} from "vitest";
import { WebSocket as NodeWebSocket } from "ws";
import { ChangeEmitter } from "../../../apps/server/src/changeEmitter.ts";
import {
	closeVaultServer,
	createVaultServer,
} from "../../../apps/server/src/server.ts";
import { LocalDiskStore } from "../../../apps/server/src/store.ts";
import type { Vault } from "../../../apps/server/src/vault.ts";
import {
	createFixture,
	type Fixture,
} from "../../../apps/server/test/helpers.ts";
import type { VaultBackend } from "../../../src/lib/vaultBackend/types";
import type { SocketLike } from "../src/collabProvider.ts";
import {
	createRemoteVaultBackend,
	type RemoteBindings,
} from "../src/remoteVaultBackend.ts";

/**
 * A response body nobody reads keeps its request open in a browser until the response is
 * garbage collected, which holds a connection and keeps the page from going network-idle.
 * The backend reads every body it fetches, or lets go of it.
 */

const TOKEN = "test-token-0123456789";

let fixture: Fixture;
let vault: Vault;
let server: Server;
let backend: VaultBackend<RemoteBindings>;
let fetchSpy: MockInstance<typeof fetch>;

/** Paths of the responses the backend received and neither read nor let go of. */
async function unreleased(): Promise<string[]> {
	const responses = await Promise.all(
		fetchSpy.mock.results.map((result) => result.value as Promise<Response>),
	);
	expect(responses.length).toBeGreaterThan(0);
	return responses
		.filter((response) => response.body !== null && !response.bodyUsed)
		.map((response) => new URL(response.url).pathname);
}

beforeEach(async () => {
	fixture = await createFixture();
	vault = await fixture.openVault();
	server = await createVaultServer({
		vault,
		store: new LocalDiskStore(join(fixture.root, "server", "state")),
		token: TOKEN,
		maxBodyBytes: 1024 * 1024,
		changes: new ChangeEmitter(),
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	fetchSpy = vi.spyOn(globalThis, "fetch");
	backend = createRemoteVaultBackend({
		baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
		token: TOKEN,
		createSocket: (url) => new NodeWebSocket(url) as unknown as SocketLike,
	});
});

afterEach(async () => {
	fetchSpy.mockRestore();
	await closeVaultServer(server);
	await vault.idle();
	await fixture.cleanup();
});

describe("the remote vault backend's responses", () => {
	it("are all consumed when a note opens as a live document", async () => {
		const collab = backend.collab as NonNullable<typeof backend.collab>;
		const doc = await collab.openDoc("welcome.md");
		await doc.synced;
		doc.close();

		expect(await unreleased()).toEqual([]);
	});

	it("are all consumed by writes, conflicting writes and deletes", async () => {
		const { revision } = await backend.files.read("welcome.md");
		await backend.files.write("welcome.md", "# Updated\n", {
			baseRevision: revision,
		});
		await backend.files.write("welcome.md", "# Stale\n", {
			baseRevision: revision,
		});
		await backend.files.delete(["welcome.md"]);

		expect(await unreleased()).toEqual([]);
	});

	it("are consumed when the server refuses a request", async () => {
		await expect(backend.files.read("missing.md")).rejects.toMatchObject({
			status: 404,
		});

		expect(await unreleased()).toEqual([]);
	});
});
