import type {
	VaultAttachment,
	VaultAttachmentUpload,
} from "../../../src/lib/vaultBackend/types";
import {
	type AttachmentImportRequest,
	ROUTES,
	type WriteResult,
} from "../../protocol/src/index.ts";
import {
	assertVaultPath,
	encoded,
	jsonWithStrings,
	ok,
	type Request,
} from "./remoteHttp.ts";

/**
 * Attachments on a Memoria remote (TOL-204): images are files under `attachments/`, named the
 * way the desktop app names them, so a note that links one shows it on every device after a
 * pull. Reads carry the bearer token like every other request; the shell turns the bytes into
 * an object URL because an `<img>` cannot send that header itself.
 */

export interface RemoteAttachments {
	/** Stores the bytes as a new file; resolves with its vault-relative path. */
	save(upload: VaultAttachmentUpload): Promise<VaultAttachment>;
	/** The attachment's bytes, typed after its extension so an `<img>` can show them. */
	read(path: string): Promise<Blob>;
	/** Has the server download a public image; resolves with where it stored it. */
	importFromUrl(url: string): Promise<VaultAttachment>;
}

const ATTACHMENTS_DIR = "attachments";
const UNSAFE_NAME_CHARACTERS = /[^\p{L}\p{N}._-]/gu;
const FALLBACK_NAME = "image";
const IMAGE_TYPES = new Map([
	["png", "image/png"],
	["jpg", "image/jpeg"],
	["jpeg", "image/jpeg"],
	["gif", "image/gif"],
	["webp", "image/webp"],
	["svg", "image/svg+xml"],
	["bmp", "image/bmp"],
	["tiff", "image/tiff"],
]);
/** A created file, or the conflict copy the server kept when the name was taken meanwhile. */
const STORED_STATUSES = new Set([201, 409]);

/** `attachments/<millis>-<name>`, with the name reduced to what the desktop app keeps. */
export function attachmentUploadPath(filename: string, now = Date.now()): string {
	const safe = filename.replace(UNSAFE_NAME_CHARACTERS, "_").replace(/^\.+/u, "");
	return `${ATTACHMENTS_DIR}/${now}-${safe || FALLBACK_NAME}`;
}

export function attachmentContentType(path: string): string {
	const extension = path.split(".").pop()?.toLowerCase() ?? "";
	return IMAGE_TYPES.get(extension) ?? "application/octet-stream";
}

async function storedPath(response: Response): Promise<VaultAttachment> {
	const stored = STORED_STATUSES.has(response.status) ? response : await ok(response);
	const { path } = await jsonWithStrings<keyof Pick<WriteResult, "path">>(
		stored,
		["path"],
		"write result",
	);
	assertVaultPath(path);
	return { path };
}

export function remoteAttachments(
	request: Request,
	now: () => number = Date.now,
): RemoteAttachments {
	return {
		save: async ({ filename, bytes }) => {
			const path = attachmentUploadPath(filename, now());
			const response = await request(`${ROUTES.files}/${encoded(path)}`, {
				method: "PUT",
				headers: { "if-none-match": "*" },
				body: new Blob([bytes as BlobPart]),
			});
			return storedPath(response);
		},
		read: async (path) => {
			assertVaultPath(path);
			const response = await ok(await request(`${ROUTES.files}/${encoded(path)}`));
			const bytes = await response.arrayBuffer();
			return new Blob([bytes], { type: attachmentContentType(path) });
		},
		importFromUrl: async (url) => {
			const body: AttachmentImportRequest = { url };
			const response = await request(ROUTES.attachmentImports, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			return storedPath(response);
		},
	};
}
