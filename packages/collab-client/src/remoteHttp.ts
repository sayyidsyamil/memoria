/** HTTP plumbing shared by the modules of the remote vault backend. */

export type Request = (path: string, init?: RequestInit) => Promise<Response>;

export class RemoteError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "RemoteError";
		this.status = status;
	}
}

/** A vault path as a URL path: every segment percent-encoded, the slashes kept. */
export function encoded(path: string): string {
	return path.split("/").map(encodeURIComponent).join("/");
}

export function etagOf(response: Response): string {
	return (response.headers.get("etag") ?? "").replaceAll('"', "");
}

/**
 * Lets go of a body the caller does not read. In a browser an unread body keeps its request
 * open until the response is garbage collected, holding a connection meanwhile, and the page
 * never goes network-idle.
 *
 * The body is read to its end, not cancelled (TOL-230): in WebKit, cancelling a body the
 * service worker is serving can leave every later request of the page waiting forever, so
 * the next note's collaboration ticket never comes back. The bodies let go of here are small:
 * a note read for its headers, a write's or an error's answer.
 */
export async function released(response: Response): Promise<Response> {
	await response.arrayBuffer().catch(() => undefined);
	return response;
}

export async function ok(response: Response): Promise<Response> {
	if (response.ok) return response;
	await released(response);
	const route = response.url ? new URL(response.url).pathname : "the request";
	throw new RemoteError(
		response.status,
		`the server answered ${response.status} for ${route}`,
	);
}

/** A malformed answer from the server: refused before any of it is used. */
export function malformed(what: string): RemoteError {
	return new RemoteError(502, `the server sent a malformed ${what}`);
}

/** Reads a JSON body whose `fields` must all be non-empty strings. */
export async function jsonWithStrings<K extends string>(
	response: Response,
	fields: readonly K[],
	what: string,
): Promise<Record<K, string>> {
	const body: unknown = await response.json().catch(() => null);
	const record = (body ?? {}) as Record<string, unknown>;
	const valid = fields.every(
		(field) => typeof record[field] === "string" && record[field] !== "",
	);
	if (!valid) throw malformed(what);
	return record as Record<K, string>;
}

/**
 * A vault path as the protocol defines it: relative, `/`-separated, with no empty, `.` or
 * `..` segment. The server checks it too; the client refuses it before sending it anywhere.
 */
export function assertVaultPath(path: string): void {
	const segments = path.split("/");
	const invalid =
		path.includes("\\") ||
		segments.some(
			(segment) => segment === "" || segment === "." || segment === "..",
		);
	if (invalid) throw new RemoteError(400, `"${path}" is not a vault path`);
}
