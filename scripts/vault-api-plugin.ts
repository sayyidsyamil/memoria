import { mkdirSync, renameSync, unlinkSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";
import {
	filenameRenameTitle,
	markdownSiblingPath,
	runVaultCommand,
	updatePathWikilinks,
	type VaultCommandPayload,
	validateMarkdownFilenameStem,
	vaultCommandContext,
} from "./vault-api-commands.ts";
import { pathExists, readUtf8File, writeUtf8File } from "./vault-api-data.ts";

function sendJson(
	res: ServerResponse,
	payload: unknown,
	statusCode = 200,
): void {
	res.statusCode = statusCode;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify(payload));
}

const VAULT_ENDPOINT_ARG_KEYS = [
	"path",
	"vault_path",
	"query",
	"mode",
	"reload",
	"exclude_frontmatter",
] as const;

function readVaultQueryArgs(url: URL): Record<string, unknown> {
	const args: Record<string, unknown> = {};
	for (const key of VAULT_ENDPOINT_ARG_KEYS) {
		const value = url.searchParams.get(key);
		if (value !== null) Reflect.set(args, key, value);
	}
	return args;
}

async function readVaultEndpointArgs(
	url: URL,
	req: IncomingMessage,
): Promise<Record<string, unknown>> {
	if (req.method === "POST") return readJsonBody<Record<string, unknown>>(req);
	return readVaultQueryArgs(url);
}

async function saveVaultContent(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const { path: filePath, content } = await readJsonBody<{
		path?: string;
		content?: string;
	}>(req);
	if (!filePath || content === undefined) {
		sendJson(res, { error: "Missing path or content" }, 400);
		return;
	}

	mkdirSync(path.dirname(filePath), { recursive: true });
	writeUtf8File(filePath, content);
	sendJson(res, null);
}

async function renameVaultNoteTitle(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const {
		vault_path: vaultPath,
		old_path: oldPath,
		new_title: newTitle,
	} = await readJsonBody<{
		vault_path?: string;
		old_path: string;
		new_title: string;
	}>(req);
	const oldContent = readUtf8File(oldPath);
	const oldTitle = oldContent.match(/^# (.+)$/m)?.[1]?.trim() ?? "";
	const slug = newTitle
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "");
	const newPath = markdownSiblingPath(oldPath, slug);
	if (!newPath) {
		sendJson(res, { error: "Invalid title" }, 400);
		return;
	}

	writeUtf8File(newPath, oldContent.replace(/^# .+$/m, `# ${newTitle}`));
	if (newPath !== oldPath) unlinkSync(oldPath);

	const updatedFiles = vaultPath
		? updatePathWikilinks({ newPath, oldPath: newPath, oldTitle, vaultPath })
		: 0;
	sendJson(res, { new_path: newPath, updated_files: updatedFiles });
}

async function renameVaultNoteFilename(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const {
		vault_path: vaultPath,
		old_path: oldPath,
		new_filename_stem: newFilenameStem,
	} = await readJsonBody<{
		vault_path?: string;
		old_path: string;
		new_filename_stem: string;
	}>(req);
	const filename = validateMarkdownFilenameStem(newFilenameStem);
	if (!filename.ok) {
		sendJson(res, { error: filename.error }, 400);
		return;
	}

	const newPath = markdownSiblingPath(oldPath, filename.stem);
	if (!newPath) {
		sendJson(res, { error: "Invalid filename" }, 400);
		return;
	}
	if (newPath !== oldPath && pathExists(newPath)) {
		sendJson(res, { error: "A note with that name already exists" }, 409);
		return;
	}

	const oldTitle = filenameRenameTitle(oldPath);
	renameSync(oldPath, newPath);
	const updatedFiles = vaultPath
		? updatePathWikilinks({ newPath, oldPath, oldTitle, vaultPath })
		: 0;
	sendJson(res, { new_path: newPath, updated_files: updatedFiles });
}

interface VaultRoute {
	cmd?: string;
	write?: (context: VaultRequest) => Promise<void>;
	fallback: string;
}
interface VaultRequest {
	req: IncomingMessage;
	res: ServerResponse;
	url: URL;
}
const VAULT_ROUTES = new Map<string, VaultRoute>([
	["list", { cmd: "list_vault", fallback: "Vault read failed" }],
	["content", { cmd: "get_note_content", fallback: "Vault read failed" }],
	["all-content", { cmd: "get_all_content", fallback: "Vault read failed" }],
	["entry", { cmd: "reload_vault_entry", fallback: "Vault read failed" }],
	["search", { cmd: "search_vault", fallback: "Vault read failed" }],
	[
		"save",
		{
			write: ({ req, res }) => saveVaultContent(req, res),
			fallback: "Save failed",
		},
	],
	[
		"rename",
		{
			write: ({ req, res }) => renameVaultNoteTitle(req, res),
			fallback: "Rename failed",
		},
	],
	[
		"rename-filename",
		{
			write: ({ req, res }) => renameVaultNoteFilename(req, res),
			fallback: "Rename failed",
		},
	],
	["delete", { write: deleteVaultNote, fallback: "Delete failed" }],
	["command", { write: executeVaultCommand, fallback: "Vault command failed" }],
]);
async function deleteVaultNote({ req, res }: VaultRequest): Promise<void> {
	const { path: filePath } = await readJsonBody<{ path?: string }>(req);
	if (!filePath) {
		sendJson(res, { error: "Missing path" }, 400);
		return;
	}
	unlinkSync(filePath);
	sendJson(res, filePath);
}
async function executeVaultCommand({ req, res }: VaultRequest): Promise<void> {
	const context = vaultCommandContext(
		await readJsonBody<VaultCommandPayload>(req),
	);
	if (!context) {
		sendJson(res, { error: "Invalid vault command" }, 400);
		return;
	}
	const response = runVaultCommand(context);
	sendJson(res, response.payload, response.statusCode);
}
function acceptsVaultMethod({
	route,
	method,
}: {
	route: VaultRoute;
	method?: string;
}): boolean {
	return method === "POST" || Boolean(route.cmd && method === "GET");
}
async function dispatchVaultRoute({
	route,
	request,
}: {
	route: VaultRoute;
	request: VaultRequest;
}): Promise<void> {
	if (route.write) {
		await route.write(request);
		return;
	}
	const args = await readVaultEndpointArgs(request.url, request.req);
	const response = runVaultCommand({ args, cmd: route.cmd ?? "" });
	sendJson(request.res, response.payload, response.statusCode);
}
async function handleVaultApiRequest(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<boolean> {
	const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
	if (url.pathname === "/api/vault/ping") {
		sendJson(res, { ok: true });
		return true;
	}
	if (!url.pathname.startsWith("/api/vault/")) return false;
	const route = VAULT_ROUTES.get(url.pathname.replace(/^\/api\/vault\//, ""));
	if (!route) return false;
	if (!acceptsVaultMethod({ route, method: req.method })) {
		if (!route.cmd) return false;
		sendJson(res, { error: "Unsupported method" }, 405);
		return true;
	}
	try {
		await dispatchVaultRoute({ route, request: { req, res, url } });
	} catch (err: unknown) {
		sendCaughtError(res, err, route.fallback);
	}
	return true;
}

export function vaultApiPlugin(): Plugin {
	return {
		name: "vault-api",
		configureServer(server) {
			server.middlewares.use(async (req, res, next) => {
				if (await handleVaultApiRequest(req, res)) return;
				next();
			});
		},
	};
}

// --- Proxy helpers ---

function readRequestBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		let body = "";
		req.on("data", (chunk: Buffer) => {
			body += chunk.toString();
		});
		req.on("end", () => resolve(body));
	});
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
	return JSON.parse(await readRequestBody(req)) as T;
}

function sendCaughtError(
	res: ServerResponse,
	err: unknown,
	fallback: string,
): void {
	sendJson(res, { error: err instanceof Error ? err.message : fallback }, 500);
}
