import { type ChildProcess, spawn } from "node:child_process";
import { connect, createServer, type Server, type Socket } from "node:net";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { REMOTE_URL } from "../playwright.config";

/**
 * The bundle on its own origin for offline.spec.ts, so the test can take the network away
 * for real: once it stops, every connection to the origin is refused, the service worker's
 * own included. Playwright's `setOffline` cannot stand in for this with a service worker:
 * WebKit fails every load before the worker sees it, and Chromium lets the worker's fetches
 * through after a navigation.
 *
 * One preview server runs for the whole worker on a port of its own; the origin's port is a
 * listener in this process that forwards to it while the network is up and is closed while
 * it is down. A preview server spawned for every start sometimes never answered on CI, and
 * its output was discarded, so nothing said why.
 */

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const LOOPBACK = "127.0.0.1";
const OFFLINE_ORIGIN_PORT = Number(process.env.MEMORIA_E2E_OFFLINE_PORT ?? "41762");
export const OFFLINE_ORIGIN = `http://${LOOPBACK}:${OFFLINE_ORIGIN_PORT}`;
// Inside the 45 s test timeout, so a server that never answers fails with its own output.
const PREVIEW_START_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 2_000;
const POLL_INTERVAL_MS = 200;
const OUTPUT_LIMIT = 4_000;

async function isReachable(url: string): Promise<boolean> {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
		await response.body?.cancel();
		return response.ok;
	} catch {
		return false;
	}
}

/** A port nothing listens on right now, for the preview server behind the origin. */
async function freePort(): Promise<number> {
	const probe = createServer();
	await new Promise<void>((resolve, reject) => {
		probe.once("error", reject);
		probe.listen(0, LOOPBACK, resolve);
	});
	const address = probe.address();
	await new Promise<void>((resolve) => probe.close(() => resolve()));
	if (address === null || typeof address === "string") throw new Error("no free port");
	return address.port;
}

function pipeBothWays(client: Socket, upstream: Socket): void {
	client.pipe(upstream).pipe(client);
	client.on("error", () => upstream.destroy());
	upstream.on("error", () => client.destroy());
	client.on("close", () => upstream.destroy());
	upstream.on("close", () => client.destroy());
}

class PreviewServer {
	private process: ChildProcess | null = null;
	private output = "";
	private exit: string | null = null;
	readonly url: string;

	constructor(readonly port: number) {
		this.url = `http://${LOOPBACK}:${port}`;
	}

	async start(): Promise<void> {
		const child = spawn("pnpm", ["preview:web", "--port", String(this.port)], {
			cwd: REPO_ROOT,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, MEMORIA_REMOTE_URL: REMOTE_URL },
		});
		this.process = child;
		const record = (chunk: Buffer) => {
			this.output = (this.output + chunk.toString()).slice(-OUTPUT_LIMIT);
		};
		child.stdout?.on("data", record);
		child.stderr?.on("data", record);
		child.once("exit", (code, signal) => {
			this.exit = `exited with ${signal ?? code}`;
		});
		await this.waitUntilReady();
	}

	/** Fails fast, with what the server printed, when it exits instead of answering. */
	private async waitUntilReady(): Promise<void> {
		const deadline = Date.now() + PREVIEW_START_TIMEOUT_MS;
		while (this.exit === null && Date.now() < deadline) {
			if (await isReachable(this.url)) return;
			await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
		}
		throw new Error(`preview server on ${this.url} did not start: ${this.describe()}`);
	}

	describe(): string {
		return `${this.exit ?? "still running"}\n${this.output}`;
	}

	stop(): void {
		const pid = this.process?.pid;
		this.process = null;
		if (pid && this.exit === null) process.kill(-pid, "SIGTERM");
	}
}

export class OfflineOrigin {
	private preview: PreviewServer | null = null;
	private listener: Server | null = null;
	private readonly connections = new Set<Socket>();

	/** The network comes back: the bundle and the `/v1` proxy answer again. */
	async start(): Promise<void> {
		const preview = await this.runningPreview();
		const listener = createServer((client) => this.forward(client, preview.port));
		await new Promise<void>((resolve, reject) => {
			listener.once("error", reject);
			listener.listen(OFFLINE_ORIGIN_PORT, LOOPBACK, resolve);
		});
		this.listener = listener;
		expect(await isReachable(OFFLINE_ORIGIN)).toBe(true);
	}

	/** The network goes away: nothing on this origin answers any more. */
	async stop(): Promise<void> {
		const listener = this.listener;
		this.listener = null;
		for (const connection of this.connections) connection.destroy();
		this.connections.clear();
		if (listener) await new Promise<void>((resolve) => listener.close(() => resolve()));
		expect(await isReachable(OFFLINE_ORIGIN)).toBe(false);
	}

	/** The end of the worker: the origin and the preview server behind it go away. */
	async dispose(): Promise<void> {
		await this.stop();
		this.preview?.stop();
		this.preview = null;
	}

	private async runningPreview(): Promise<PreviewServer> {
		if (this.preview) return this.preview;
		const preview = new PreviewServer(await freePort());
		process.once("exit", () => preview.stop());
		try {
			await preview.start();
		} catch (error) {
			preview.stop();
			throw error;
		}
		this.preview = preview;
		return preview;
	}

	private forward(client: Socket, port: number): void {
		const upstream = connect(port, LOOPBACK);
		for (const socket of [client, upstream]) {
			this.connections.add(socket);
			socket.once("close", () => this.connections.delete(socket));
		}
		pipeBothWays(client, upstream);
	}
}
