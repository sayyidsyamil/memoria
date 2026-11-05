import { describe, expect, it } from "vitest";
import { ok, released } from "../src/remoteHttp.ts";

/**
 * TOL-230: a body the backend does not need is read to its end, never cancelled. In WebKit,
 * cancelling a body the service worker is serving can leave every later request of the page
 * waiting forever, so the next note's collaboration ticket never comes back.
 */

interface TrackedBody {
	response: Response;
	cancelled: () => boolean;
	chunksLeft: () => number;
}

function trackedResponse(status = 200): TrackedBody {
	const chunks = ["# Note\n", "\nA body nobody needs.\n"];
	let cancelled = false;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			const chunk = chunks.shift();
			if (chunk === undefined) controller.close();
			else controller.enqueue(new TextEncoder().encode(chunk));
		},
		cancel() {
			cancelled = true;
		},
	});
	return {
		response: new Response(body, { status }),
		cancelled: () => cancelled,
		chunksLeft: () => chunks.length,
	};
}

describe("letting go of a response body", () => {
	it("reads the body to its end instead of cancelling it", async () => {
		const tracked = trackedResponse();

		const response = await released(tracked.response);

		expect(response).toBe(tracked.response);
		expect(response.bodyUsed).toBe(true);
		expect(tracked.cancelled()).toBe(false);
		expect(tracked.chunksLeft()).toBe(0);
	});

	it("reads a refused request's body to its end before throwing", async () => {
		const tracked = trackedResponse(404);

		await expect(ok(tracked.response)).rejects.toMatchObject({ status: 404 });

		expect(tracked.cancelled()).toBe(false);
		expect(tracked.chunksLeft()).toBe(0);
	});

	it("lets a body that fails while being read go without throwing", async () => {
		const failing = new Response(
			new ReadableStream({
				pull(controller) {
					controller.error(new Error("connection reset"));
				},
			}),
		);

		await expect(released(failing)).resolves.toBe(failing);
	});

	it("passes a response without a body through", async () => {
		const empty = new Response(null, { status: 204 });

		await expect(released(empty)).resolves.toBe(empty);
	});
});
