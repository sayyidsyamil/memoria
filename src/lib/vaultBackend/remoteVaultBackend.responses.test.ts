import { describe, expect, it } from "vitest";
import { createRemoteVaultBackend } from "../../../packages/collab-client/src/remoteVaultBackend";

/**
 * TOL-190: the remote backend reads every response body or lets go of it. In a browser an
 * unread body keeps its request open until the response is garbage collected, so a reload
 * never reached network idle. A stubbed server answers; each response is kept to inspect.
 */

function backendAnswering(answer: (path: string) => Response) {
	const responses: Response[] = [];
	const backend = createRemoteVaultBackend({
		baseUrl: "https://vault.example",
		token: "token-for-tests",
		fetch: (async (url: string) => {
			const response = answer(new URL(url).pathname);
			responses.push(response);
			return response;
		}) as typeof fetch,
	});
	return { backend, responses };
}

function withUrl(response: Response, url: string): Response {
	Object.defineProperty(response, "url", { value: url });
	return response;
}

describe("the remote backend releases the bodies it does not read", () => {
	it("after a write the server accepted", async () => {
		const { backend, responses } = backendAnswering(
			() =>
				new Response(JSON.stringify({ outcome: "written" }), {
					status: 200,
					headers: { etag: '"rev-2"' },
				}),
		);

		const result = await backend.files.write("notes/a.md", "# A\n", {
			baseRevision: "rev-1",
		});

		expect(result).toEqual({ status: "written", revision: "rev-2" });
		expect(responses.map((response) => response.bodyUsed)).toEqual([true]);
	});

	it("after a refused request, naming the route it was refused for", async () => {
		const { backend, responses } = backendAnswering((path) =>
			withUrl(
				new Response('{"error":"not_found"}', { status: 404 }),
				`https://vault.example${path}`,
			),
		);

		await expect(backend.files.read("notes/missing.md")).rejects.toMatchObject({
			status: 404,
			message: "the server answered 404 for /v1/files/notes/missing.md",
		});
		expect(responses.map((response) => response.bodyUsed)).toEqual([true]);
	});

	it("after a refused response that carries no URL", async () => {
		const { backend, responses } = backendAnswering(
			() => new Response("denied", { status: 403 }),
		);

		await expect(backend.files.read("notes/a.md")).rejects.toMatchObject({
			status: 403,
			message: "the server answered 403 for the request",
		});
		expect(responses.map((response) => response.bodyUsed)).toEqual([true]);
	});
});
