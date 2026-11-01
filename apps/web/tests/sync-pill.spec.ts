import {
	expect,
	type Page,
	type TestInfo,
	test,
	type WebSocketRoute,
} from "@playwright/test";
import * as Y from "yjs";
import { updateMessage } from "../../../packages/protocol/src/collabWire";
import { COLLAB_TOKEN } from "../playwright.config";

/**
 * TOL-201: the web status bar shows one sync pill in place of the git controls. Every state
 * is driven here through the network the app really uses, and the pill's spinning icon is
 * the only busy indicator: nothing spins or pulses over the note list or the editor.
 */

// The routes below must see the app's requests, which a service worker would answer first.
test.use({ serviceWorkers: "block" });
test.describe.configure({ retries: 0 });

const NOTE_TITLE = "Welcome";
const COLLAB_SOCKET = /\/v1\/collab\//;
const BUSY_INDICATORS =
	'.animate-spin, .animate-pulse, [role="progressbar"], [data-testid="note-list-loading-skeleton"]';

type PillState = "connecting" | "syncing" | "synced" | "offline" | "conflict";

/** A request or message held until the test lets it through. */
function gate() {
	let open: () => void = () => {};
	const opened = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { opened, open };
}

async function openApp(page: Page): Promise<void> {
	await page.addInitScript((token) => {
		window.MEMORIA_REMOTE_URL = window.location.origin;
		window.MEMORIA_REMOTE_TOKEN = token;
	}, COLLAB_TOKEN);
	await page.goto("/", { waitUntil: "load" });
	await expect(noteListItem(page)).toBeVisible({ timeout: 10_000 });
}

function noteListItem(page: Page) {
	return page
		.getByTestId("note-list-container")
		.getByText(NOTE_TITLE, { exact: true });
}

function pill(page: Page) {
	return page.getByTestId("status-sync-pill");
}

async function expectPill(
	page: Page,
	state: PillState,
	testInfo: TestInfo,
): Promise<void> {
	await expect(pill(page)).toHaveAttribute("data-state", state, {
		timeout: 10_000,
	});
	const icon = pill(page).getByTestId("sync-pill-icon");
	if (state === "connecting" || state === "syncing")
		await expect(icon).toHaveClass(/animate-spin/);
	else await expect(icon).not.toHaveClass(/animate-spin/);
	await testInfo.attach(`sync-pill-${state}`, {
		body: await pill(page).screenshot(),
		contentType: "image/png",
	});
}

/** Luca's rule: the pill's icon is the one indicator; the note list and the editor stay still. */
async function expectOnlyThePillIsBusy(page: Page): Promise<void> {
	await expect(
		page.getByTestId("note-list-container").locator(BUSY_INDICATORS),
	).toHaveCount(0);
	await expect(page.locator(".editor").locator(BUSY_INDICATORS)).toHaveCount(0);
	await expect(page.locator(".animate-spin")).toHaveCount(1);
	await expect(pill(page).locator(".animate-spin")).toHaveCount(1);
}

async function openNote(page: Page): Promise<void> {
	await noteListItem(page).click();
}

interface ForwardedSocket {
	/** The page's end of the note's socket, once the note is opened. */
	client: Promise<WebSocketRoute>;
	/** Stops sending the page's messages on to the server. */
	mute(): void;
}

/**
 * Forwards the note's socket both ways, holding what the server sends until `held` opens.
 * Sockets are only routed when the route is in place before the page loads.
 */
async function forwardCollabSocket(
	page: Page,
	held: Promise<void> = Promise.resolve(),
): Promise<ForwardedSocket> {
	let connected: (route: WebSocketRoute) => void = () => {};
	let muted = false;
	const client = new Promise<WebSocketRoute>((resolve) => {
		connected = resolve;
	});
	await page.routeWebSocket(COLLAB_SOCKET, (route) => {
		const server = route.connectToServer();
		server.onMessage((message) => {
			void held.then(() => route.send(message));
		});
		route.onMessage((message) => {
			if (!muted) server.send(message);
		});
		connected(route);
	});
	return { client, mute: () => (muted = true) };
}

/** The phone shows the note or the list (TOL-193): back to the list there; true on a phone. */
async function showNoteList(page: Page): Promise<boolean> {
	const back = page.getByTestId("phone-back-to-notes");
	if (!(await back.isVisible())) return false;
	await back.click();
	return true;
}

test("is synced, and only the pill spins while the vault reloads in the background", async ({
	page,
}, testInfo) => {
	await openApp(page);
	await openNote(page);
	await expectPill(page, "synced", testInfo);
	await expect(page.getByTestId("status-commit-push")).toHaveCount(0);
	await showNoteList(page);

	const reload = gate();
	await page.route("**/v1/entries**", async (route) => {
		await reload.opened;
		await route.continue();
	});
	await page.evaluate(() =>
		window.__laputaTest?.dispatchBrowserMenuCommand?.("vault-reload"),
	);

	await expectPill(page, "syncing", testInfo);
	await expectOnlyThePillIsBusy(page);
	await expect(noteListItem(page)).toBeVisible();

	reload.open();
	await expectPill(page, "synced", testInfo);
});

test("is connecting while the note's document is opened", async ({
	page,
}, testInfo) => {
	await openApp(page);
	const ticket = gate();
	await page.route("**/v1/collab/tickets", async (route) => {
		await ticket.opened;
		await route.continue();
	});

	await openNote(page);
	await expectPill(page, "connecting", testInfo);
	await expectOnlyThePillIsBusy(page);

	ticket.open();
	await expectPill(page, "synced", testInfo);
});

test("is syncing while the document catches up with the server", async ({
	page,
}, testInfo) => {
	const caughtUp = gate();
	await forwardCollabSocket(page, caughtUp.opened);
	await openApp(page);

	await openNote(page);
	await expectPill(page, "syncing", testInfo);
	await expectOnlyThePillIsBusy(page);

	caughtUp.open();
	await expectPill(page, "synced", testInfo);
});

test("is offline while the server cannot be reached, and synced once it is back", async ({
	page,
}, testInfo) => {
	let reachable = true;
	const sockets: WebSocketRoute[] = [];
	await page.routeWebSocket(COLLAB_SOCKET, (route) => {
		if (!reachable) return route.close();
		route.connectToServer();
		sockets.push(route);
	});
	await openApp(page);
	await openNote(page);
	await expectPill(page, "synced", testInfo);

	reachable = false;
	for (const socket of sockets) await socket.close();
	await expectPill(page, "offline", testInfo);

	reachable = true;
	await expectPill(page, "synced", testInfo);
});

test("shows a conflict when the server kept the edits as a conflict copy", async ({
	page,
}, testInfo) => {
	const { client, mute } = await forwardCollabSocket(page);
	await openApp(page);
	await openNote(page);
	await expectPill(page, "synced", testInfo);

	// What the server sends when it forks a conflict copy: the copy's path in the meta map.
	// The server puts back a meta map a client writes to, so the page's echo stays here.
	mute();
	const conflict = new Y.Doc();
	conflict.getMap<string>("meta").set("conflictCopy", "Welcome (conflict).md");
	(await client).send(
		Buffer.from(updateMessage(Y.encodeStateAsUpdate(conflict))),
	);

	await expectPill(page, "conflict", testInfo);
	await expect(pill(page)).toHaveAttribute("title", /Welcome \(conflict\)\.md/);
});
