import { createHash, timingSafeEqual } from "node:crypto";
import type {
	IncomingHttpHeaders,
	IncomingMessage,
	ServerResponse,
} from "node:http";
import {
	PROTOCOL_HEADER,
	PROTOCOL_VERSION,
} from "../../../packages/protocol/src/index.ts";
import { VaultError } from "./errors.ts";

export interface Reply {
	status: number;
	headers?: Record<string, string>;
	/** Bytes are sent as they are; anything else is sent as JSON. */
	body?: Uint8Array | object;
	/** Marker that this reply is SSE and was already written directly to the response. */
	sse?: boolean;
}

const WEAK_PREFIX = "W/";
const QUOTE = '"';

const BASE_HEADERS = {
	[PROTOCOL_HEADER]: PROTOCOL_VERSION,
	"cache-control": "no-store",
	"x-content-type-options": "nosniff",
	"x-frame-options": "DENY",
};

/** The value of a header that may legally arrive more than once: the first one counts. */
export function singleHeader(
	headers: IncomingHttpHeaders,
	name: string,
): string | undefined {
	const value = headers[name];
	if (Array.isArray(value)) return value[0];
	return value;
}

function digest(value: string): Buffer {
	return createHash("sha256").update(value).digest();
}

/** Compares digests so the check takes the same time wherever the tokens differ. */
export function isAuthorized(
	header: string | undefined,
	token: string,
): boolean {
	const match = /^Bearer (\S+)$/.exec(header ?? "");
	return match !== null && timingSafeEqual(digest(match[1]), digest(token));
}

/** `"abc"` or `W/"abc"` -> `abc`; `*` stays `*`; a missing header is undefined. */
export function entityTag(header: string | undefined): string | undefined {
	const value = header?.trim();
	if (!value) return undefined;
	if (value === "*") return value;
	const strong = value.startsWith(WEAK_PREFIX)
		? value.slice(WEAK_PREFIX.length)
		: value;
	return strong.split(QUOTE).join("");
}

export function quoted(etag: string): string {
	return `"${etag}"`;
}

function declaredLength(request: IncomingMessage): number {
	return Number(request.headers["content-length"] ?? 0);
}

function tooLarge(maxBytes: number): VaultError {
	return new VaultError(
		413,
		"payload_too_large",
		`the body is larger than ${maxBytes} bytes`,
	);
}

/** Reads the request body, refusing anything larger than `maxBytes`. */
export async function readBody(
	request: IncomingMessage,
	maxBytes: number,
): Promise<Buffer> {
	if (declaredLength(request) > maxBytes) throw tooLarge(maxBytes);
	const chunks: Buffer[] = [];
	let received = 0;
	for await (const chunk of request) {
		received += (chunk as Buffer).byteLength;
		if (received > maxBytes) throw tooLarge(maxBytes);
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks);
}

function payload(reply: Reply): { bytes: Uint8Array; contentType?: string } {
	if (reply.body === undefined) return { bytes: new Uint8Array() };
	if (reply.body instanceof Uint8Array) return { bytes: reply.body };
	const bytes = Buffer.from(JSON.stringify(reply.body));
	return { bytes, contentType: "application/json; charset=utf-8" };
}

export function send(response: ServerResponse, reply: Reply): void {
	const { bytes, contentType } = payload(reply);
	const headers: Record<string, string> = { ...BASE_HEADERS, ...reply.headers };
	if (contentType) headers["content-type"] = contentType;
	headers["content-length"] = String(bytes.byteLength);
	response.writeHead(reply.status, headers);
	response.end(bytes);
}

export function errorReply(error: unknown): Reply {
	if (error instanceof VaultError) {
		const { code, message, details } = error;
		return {
			status: error.status,
			body: { error: { code, message, details } },
		};
	}
	return {
		status: 500,
		body: { error: { code: "internal", message: "internal error" } },
	};
}
