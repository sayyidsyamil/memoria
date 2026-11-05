import { createHmac, randomUUID } from "node:crypto";
import {
	createServer,
	type IncomingHttpHeaders,
	type IncomingMessage,
	request as httpRequest,
	type Server,
	type ServerResponse,
} from "node:http";
import { connect, type Socket } from "node:net";

/**
 * A stand-in for the hosted front end of Memoria Web in sharing.spec.ts (TOL-237). The real
 * one (the private Worker of memoria-cloud) keeps accounts and share records and mints access
 * tickets; this one does the same in memory, from the open protocol's text (protocol 1.9,
 * "Access tickets"), so the shell's sharing UI runs against the real Memoria server:
 *
 * - `/api/shares*`: the share API's routes and answers, for two fixed users told apart by a
 *   cookie (`memoria-e2e-user`), like the Worker's session.
 * - `/vaults/<vaultId>/v1/*`: the owner's vault for whoever it is shared with, through an
 *   access ticket minted per request; collab ticket paths keep the prefix.
 * - `/v1/*`: the owner's own vault with the server token; a user without a vault gets 503.
 * - Everything else: the preview server's static shell.
 *
 * It only ever connects to the two loopback servers of the run.
 */

const LOOPBACK = "127.0.0.1";
/** The only hosts this front forwards to: the run's own servers on loopback. */
const LOOPBACK_HOSTS = new Set([LOOPBACK]);
export const USER_COOKIE = "memoria-e2e-user";
export const VAULT_ID = "v_e2e";
const TICKET_LIFETIME_MS = 60_000;
const SHARED_PATH = /^\/vaults\/([A-Za-z0-9_-]+)(\/v1(?:[/?].*)?)$/u;

export interface FrontUser {
	userId: string;
	email: string;
	github: string;
}

export const OWNER: FrontUser = {
	userId: "u_owner",
	email: "owner@example.com",
	github: "owner-e2e",
};
export const GRANTEE: FrontUser = {
	userId: "u_ana",
	email: "ana@example.com",
	github: "ana-e2e",
};
const USERS = [OWNER, GRANTEE];

type Role = "editor" | "viewer";

interface Grant {
	scope: string;
	role: Role;
}

interface ShareRecord {
	id: string;
	scope: string;
	role: Role;
	granteeUserId: string;
}

interface Upstream {
	host: string;
	port: number;
}

interface Forward {
	upstream: Upstream;
	path: string;
	authorization: string | null;
	/** `/vaults/<id>` when collab ticket paths need the prefix back. */
	prefix: string;
}

function upstreamOf(url: string): Upstream {
	const { hostname, port } = new URL(url);
	if (!LOOPBACK_HOSTS.has(hostname))
		throw new Error(`the share front only forwards to loopback, not ${hostname}`);
	return { host: hostname, port: Number(port) };
}

/** `path` is `route`, or something under it (a sub-path or a query). */
function isUnder(path: string, route: string): boolean {
	return path === route || path.startsWith(`${route}/`) || path.startsWith(`${route}?`);
}

interface Refusal {
	status: number;
	code: string;
}

const NO_VAULT: Refusal = { status: 503, code: "no_vault_configured" };
const UNAUTHORIZED: Refusal = { status: 401, code: "unauthorized" };
const NOT_FOUND: Refusal = { status: 404, code: "not_found" };

function base64url(text: string | Buffer): string {
	return Buffer.from(text).toString("base64url");
}

/** An access ticket as the protocol defines it: `ta1.<payload>.<HMAC>`, keyed from the token. */
function mintTicket(token: string, { sub, grants }: { sub: string; grants: object[] }): string {
	const key = createHmac("sha256", token)
		.update("memoria access ticket v1")
		.digest();
	const iat = Date.now();
	const payload = { v: 1, sub, grants, iat, exp: iat + TICKET_LIFETIME_MS };
	const signed = `ta1.${base64url(JSON.stringify(payload))}`;
	return `${signed}.${base64url(createHmac("sha256", key).update(signed).digest())}`;
}

function cookieUser(headers: IncomingHttpHeaders): FrontUser | null {
	const cookies = (headers.cookie ?? "").split(";").map((part) => part.trim());
	const value = cookies
		.find((cookie) => cookie.startsWith(`${USER_COOKIE}=`))
		?.slice(USER_COOKIE.length + 1);
	return USERS.find((user) => user.userId === value) ?? null;
}

function person(userId: string) {
	const user = USERS.find((candidate) => candidate.userId === userId);
	return { userId, email: user?.email ?? null, github: user?.github ?? null };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, {
		"content-type": "application/json",
		"cache-control": "no-store",
	});
	res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, { status, code }: Refusal): void {
	sendJson(res, status, { error: { code, message: code } });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	try {
		return JSON.parse(Buffer.concat(chunks).toString() || "{}");
	} catch {
		return {};
	}
}

function findInvitee(body: Record<string, unknown>): FrontUser | null {
	return (
		USERS.find(
			(user) =>
				user.email === body.email ||
				user.github === body.github ||
				user.userId === body.userId,
		) ?? null
	);
}

/** The vault's owner, or the person the share is for. */
function mayRemove(user: FrontUser, share: ShareRecord): boolean {
	return user === OWNER || share.granteeUserId === user.userId;
}

export interface ShareFrontOptions {
	/** The preview server with the static shell. */
	previewUrl: string;
	/** The Memoria server of the run, and its token. */
	remoteUrl: string;
	token: string;
}

export class ShareFront {
	private server: Server | null = null;
	private readonly shares = new Map<string, ShareRecord>();
	/** Collab ticket requests per user, so a test can tell a reconnect loop from a stop. */
	readonly ticketRequests = new Map<string, number>();
	origin = "";

	constructor(private readonly options: ShareFrontOptions) {}

	async start(): Promise<void> {
		const server = createServer((req, res) => {
			this.handle(req, res).catch(() => sendError(res, { status: 502, code: "front_failed" }));
		});
		server.on("upgrade", (req, socket, head) =>
			this.upgrade(req, socket as Socket, head),
		);
		await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
		const address = server.address();
		if (address === null || typeof address === "string")
			throw new Error("the share front has no port");
		this.server = server;
		this.origin = `http://${LOOPBACK}:${address.port}`;
	}

	async stop(): Promise<void> {
		const server = this.server;
		this.server = null;
		if (!server) return;
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}

	/** Revokes every share, as the owner would one by one. */
	async reset(): Promise<void> {
		for (const share of [...this.shares.values()]) await this.revoke(share);
		this.ticketRequests.clear();
	}

	grantsOf(userId: string): Grant[] {
		return [...this.shares.values()]
			.filter((share) => share.granteeUserId === userId)
			.map(({ scope, role }) => ({ scope, role }));
	}

	private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const path = req.url ?? "/";
		if (isUnder(path, "/api/shares")) return this.sharesApi(req, res, path);
		const forward = this.forwardFor(req, path);
		if ("status" in forward) return sendError(res, forward);
		return this.proxy(req, res, forward);
	}

	private forwardFor(req: IncomingMessage, path: string): Forward | Refusal {
		const user = cookieUser(req.headers);
		const shared = SHARED_PATH.exec(path);
		if (shared) return this.sharedForward(user, { vaultId: shared[1] ?? "", path: shared[2] ?? "" });
		if (isUnder(path, "/v1")) return this.ownVaultForward(user, path);
		return { upstream: upstreamOf(this.options.previewUrl), path, authorization: null, prefix: "" };
	}

	/** `/v1`: the owner's vault with the token; the invitee has no vault of their own. */
	private ownVaultForward(user: FrontUser | null, path: string): Forward | Refusal {
		if (user === GRANTEE) return NO_VAULT;
		return this.serverForward({ path, prefix: "" }, `Bearer ${this.options.token}`);
	}

	private sharedForward(user: FrontUser | null, target: { vaultId: string; path: string }): Forward | Refusal {
		if (!user) return UNAUTHORIZED;
		if (target.vaultId !== VAULT_ID) return NOT_FOUND;
		const route = { path: target.path, prefix: `/vaults/${target.vaultId}` };
		if (user === OWNER) return this.serverForward(route, `Bearer ${this.options.token}`);
		const grants = this.grantsOf(user.userId);
		if (grants.length === 0) return NOT_FOUND;
		return this.serverForward(route, `Bearer ${mintTicket(this.options.token, { sub: user.userId, grants })}`);
	}

	private serverForward(route: { path: string; prefix: string }, authorization: string): Forward {
		return { upstream: upstreamOf(this.options.remoteUrl), ...route, authorization };
	}

	private proxy(req: IncomingMessage, res: ServerResponse, forward: Forward): void {
		const headers = { ...req.headers, host: `${forward.upstream.host}:${forward.upstream.port}` };
		delete headers.cookie;
		if (forward.authorization !== null) headers.authorization = forward.authorization;
		if (forward.path.startsWith("/v1/collab/tickets")) {
			const user = cookieUser(req.headers)?.userId ?? "anonymous";
			this.ticketRequests.set(user, (this.ticketRequests.get(user) ?? 0) + 1);
		}
		const upstream = httpRequest(
			{ ...forward.upstream, method: req.method, path: forward.path, headers },
			(answer) => this.relay(answer, res, forward),
		);
		upstream.on("error", () => sendError(res, { status: 502, code: "upstream_unreachable" }));
		req.pipe(upstream);
	}

	private relay(answer: IncomingMessage, res: ServerResponse, forward: Forward): void {
		const rewrite = forward.prefix !== "" && forward.path.startsWith("/v1/collab/tickets") && answer.statusCode === 200;
		if (!rewrite) {
			res.writeHead(answer.statusCode ?? 502, answer.headers);
			answer.pipe(res);
			return;
		}
		const chunks: Buffer[] = [];
		answer.on("data", (chunk: Buffer) => chunks.push(chunk));
		answer.on("end", () => {
			const body = JSON.parse(Buffer.concat(chunks).toString()) as { path: string };
			sendJson(res, 200, { ...body, path: `${forward.prefix}${body.path}` });
		});
	}

	/** Websockets: the collab channel, own or shared; the server checks the ticket in the URL. */
	private upgrade(req: IncomingMessage, client: Socket, head: Buffer): void {
		const path = req.url ?? "/";
		const shared = SHARED_PATH.exec(path);
		const upstreamPath = shared ? (shared[2] ?? "") : path;
		if (!upstreamPath.startsWith("/v1/collab/")) {
			client.destroy();
			return;
		}
		const { host, port } = upstreamOf(this.options.remoteUrl);
		const upstream = connect(port, host, () => {
			const lines = [`GET ${upstreamPath} HTTP/1.1`];
			for (let index = 0; index < req.rawHeaders.length; index += 2) {
				const name = req.rawHeaders[index] ?? "";
				if (name.toLowerCase() === "cookie") continue;
				lines.push(`${name}: ${req.rawHeaders[index + 1] ?? ""}`);
			}
			upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
			if (head.length > 0) upstream.write(head);
			client.pipe(upstream).pipe(client);
		});
		const close = () => {
			client.destroy();
			upstream.destroy();
		};
		upstream.on("error", close);
		client.on("error", close);
		upstream.on("close", close);
		client.on("close", close);
	}

	// ── The share API ───────────────────────────────────────────────────────

	private async sharesApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
		const user = cookieUser(req.headers);
		if (!user) return sendError(res, UNAUTHORIZED);
		const route = `${req.method ?? "GET"} ${path.split("?")[0] ?? path}`;
		if (route === "POST /api/shares") return this.create(req, res, user);
		if (route === "GET /api/shares") return this.list(res, user);
		if (route === "GET /api/shares/incoming") return this.incoming(res, user);
		if (route.startsWith("DELETE /api/shares/")) return this.remove(res, user, route.slice("DELETE /api/shares/".length));
		sendError(res, NOT_FOUND);
	}

	/** The owner revokes, or the invitee leaves; anyone else is told there is no such share. */
	private async remove(res: ServerResponse, user: FrontUser, id: string): Promise<void> {
		const share = this.shares.get(id);
		if (!share || !mayRemove(user, share)) return sendError(res, NOT_FOUND);
		await this.revoke(share);
		sendJson(res, 200, { revoked: true });
	}

	private view(share: ShareRecord) {
		return { id: share.id, vaultId: VAULT_ID, scope: share.scope, role: share.role, grantee: person(share.granteeUserId) };
	}

	private list(res: ServerResponse, user: FrontUser): void {
		const body = user === OWNER
			? { vaultId: VAULT_ID, shares: [...this.shares.values()].map((share) => this.view(share)) }
			: { shares: [] };
		sendJson(res, 200, body);
	}

	private incoming(res: ServerResponse, user: FrontUser): void {
		const shares = [...this.shares.values()]
			.filter((share) => share.granteeUserId === user.userId)
			.map((share) => ({ ...this.view(share), owner: person(OWNER.userId), base: `/vaults/${VAULT_ID}` }));
		sendJson(res, 200, { shares });
	}

	private async create(req: IncomingMessage, res: ServerResponse, user: FrontUser): Promise<void> {
		if (user !== OWNER) return sendError(res, NOT_FOUND);
		const body = await readJson(req);
		const grantee = findInvitee(body);
		if (!grantee) return sendError(res, { status: 404, code: "user_not_found" });
		if (grantee === OWNER) return sendError(res, { status: 400, code: "invalid_request" });
		const { share, previous } = this.upsert(grantee, body);
		if (previous?.role === "editor" && share.role === "viewer") await this.pushRevocation(grantee.userId);
		sendJson(res, previous ? 200 : 201, { share: this.view(share) });
	}

	/** Shares a scope with the invitee; the same scope again changes the role. */
	private upsert(grantee: FrontUser, body: Record<string, unknown>): { share: ShareRecord; previous?: ShareRecord } {
		const scope = typeof body.path === "string" ? body.path : "*";
		const role: Role = body.role === "viewer" ? "viewer" : "editor";
		const previous = [...this.shares.values()].find(
			(share) => share.granteeUserId === grantee.userId && share.scope === scope,
		);
		const share = { id: previous?.id ?? randomUUID(), scope, role, granteeUserId: grantee.userId };
		this.shares.set(share.id, share);
		return { share, previous };
	}

	private async revoke(share: ShareRecord): Promise<void> {
		this.shares.delete(share.id);
		await this.pushRevocation(share.granteeUserId);
	}

	/** As the Worker does: the server closes what the user's remaining grants no longer cover. */
	private async pushRevocation(subject: string): Promise<void> {
		const { host, port } = upstreamOf(this.options.remoteUrl);
		const body = JSON.stringify({ subject, grants: this.grantsOf(subject), before: Date.now() });
		await new Promise<void>((resolve, reject) => {
			const call = httpRequest(
				{ host, port, method: "POST", path: "/v1/access/revocations", headers: { authorization: `Bearer ${this.options.token}`, "content-type": "application/json" } },
				(answer) => {
					answer.resume();
					answer.on("end", resolve);
				},
			);
			call.on("error", reject);
			call.end(body);
		});
	}
}
