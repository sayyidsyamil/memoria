import type {
	VaultFolderCreateRequest,
	VaultFolderRenameRequest,
	VaultFolderRenameResult,
} from "../../../src/lib/vaultBackend/types";
import type { FolderNode } from "../../../src/types";
import { isPortableName } from "../../../src/utils/portableName";
import {
	type FolderRenameRequest,
	type FolderRequest,
	ROUTES,
} from "../../protocol/src/index.ts";
import {
	assertVaultPath,
	jsonWithStrings,
	malformed,
	ok,
	RemoteError,
	type Request,
	released,
} from "./remoteHttp.ts";
import { followMoves, type Move, rewrittenCount } from "./remoteNoteLifecycle.ts";

/**
 * Folders on the Memoria remote. Git keeps no empty folder, so the folder tree is the
 * folders of the vault's tracked files, hidden as the desktop's tree hides them (dot
 * folders and `type/`). A folder rename is one commit on the server (protocol 1.7) that
 * moves every file in it and rewrites the links that reach a moved note by its path. Creating
 * and deleting a folder are one commit each (protocol 1.8): a new folder holds an empty
 * `.keep` file, and a delete takes every file in the folder with it.
 */

/** Folders the desktop's tree leaves out (`is_folder_tree_hidden_dir`). */
function isHiddenFolder(name: string): boolean {
	return name.startsWith(".") || name === "type";
}

function byName(a: FolderNode, b: FolderNode): number {
	const left = a.name.toLowerCase();
	const right = b.name.toLowerCase();
	if (left === right) return 0;
	return left < right ? -1 : 1;
}

/** The folders above a file, outermost first, up to the first hidden one. */
function visibleFolders(path: string): string[] {
	const segments = path.split("/").slice(0, -1);
	const hidden = segments.findIndex(isHiddenFolder);
	const visible = hidden < 0 ? segments : segments.slice(0, hidden);
	return visible.map((_, depth) => visible.slice(0, depth + 1).join("/"));
}

function folderNode(path: string): FolderNode {
	return { name: path.slice(path.lastIndexOf("/") + 1), path, children: [] };
}

/** The folder tree of the given file paths, sorted by name like the desktop's. */
export function folderTree(paths: readonly string[]): FolderNode[] {
	const nodes = new Map<string, FolderNode>();
	for (const folder of paths.flatMap(visibleFolders))
		if (!nodes.has(folder)) nodes.set(folder, folderNode(folder));
	const roots: FolderNode[] = [];
	for (const node of nodes.values()) {
		const parent = nodes.get(node.path.slice(0, Math.max(node.path.lastIndexOf("/"), 0)));
		(parent ? parent.children : roots).push(node);
	}
	for (const node of nodes.values()) node.children.sort(byName);
	return roots.sort(byName);
}

function filePaths(body: unknown): string[] {
	const files = (body as { files?: unknown } | null)?.files;
	if (!Array.isArray(files)) throw malformed("file list");
	return files.map((file: { path?: unknown }) => {
		if (typeof file?.path !== "string") throw malformed("file list");
		return file.path;
	});
}

/** `GET /v1/files`, as the folder tree. */
export async function listFolders(request: Request): Promise<FolderNode[]> {
	const response = await ok(await request(ROUTES.files));
	return folderTree(filePaths(await response.json()));
}

function postJson(request: Request, route: string, body: unknown): Promise<Response> {
	return request(route, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

/** The answer, or the desktop's `message` when the server refused it with `status`. */
async function okUnless(response: Response, status: number, message: string): Promise<Response> {
	if (response.status !== status) return ok(response);
	await released(response);
	throw new RemoteError(status, message);
}

function siblingPath(folderPath: string, name: string): string {
	const parent = folderPath.slice(0, folderPath.lastIndexOf("/") + 1);
	return `${parent}${name}`;
}

function movesOf(result: Record<string, unknown>): Move[] {
	return Array.isArray(result.moved) ? (result.moved as Move[]) : [];
}

/**
 * Renames a folder in place, as the desktop's `rename_vault_folder` does, with its errors:
 * a name Windows cannot hold and a name already taken are refused. Live documents of the
 * moved notes follow their files.
 */
export async function renameFolder(
	request: Request,
	{ folderPath, newName }: VaultFolderRenameRequest,
): Promise<VaultFolderRenameResult> {
	assertVaultPath(folderPath);
	const name = newName.trim();
	if (!isPortableName(name)) throw new RemoteError(400, "Invalid folder name");
	const to = siblingPath(folderPath, name);
	if (to === folderPath) return { oldPath: folderPath, newPath: to, updatedFiles: 0 };
	const body: FolderRenameRequest = { from: folderPath, to, rewriteLinks: true };
	const response = await postJson(request, ROUTES.folderRename, body);
	const answer = await okUnless(response, 409, `Folder '${to}' already exists`);
	const result = await jsonWithStrings(answer, ["path"], "folder rename result");
	followMoves(movesOf(result));
	return { oldPath: folderPath, newPath: result.path, updatedFiles: rewrittenCount(result) };
}

/** Creates an empty folder, refusing what the desktop's `create_vault_folder` refuses. */
export async function createFolder(
	request: Request,
	{ parentPath, name }: VaultFolderCreateRequest,
): Promise<void> {
	if (!isPortableName(name)) throw new RemoteError(400, "Invalid folder name");
	const path = parentPath ? `${parentPath}/${name}` : name;
	assertVaultPath(path);
	const body: FolderRequest = { path };
	const response = await postJson(request, ROUTES.folders, body);
	await released(await okUnless(response, 409, `Folder '${name}' already exists`));
}

/** Deletes a folder with every file in it, as the desktop's `delete_vault_folder` does. */
export async function deleteFolder(request: Request, folderPath: string): Promise<string> {
	assertVaultPath(folderPath);
	const body: FolderRequest = { path: folderPath };
	const response = await postJson(request, ROUTES.folderDelete, body);
	await released(await okUnless(response, 404, `Folder does not exist: ${folderPath}`));
	return folderPath;
}
