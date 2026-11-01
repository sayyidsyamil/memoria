import { clientColor } from "../../packages/collab-client/src/presence";
import type { VaultCollabUser } from "./vaultBackend/types";

/**
 * Who this window is to the others in a note. The Memoria server has one token and no
 * accounts, so the people in a note are mostly the owner's own devices: each one is named
 * by its browser and device ("Safari · iPhone"), product names that need no translation.
 */

interface DeviceHints {
	userAgent: string;
	/** iPadOS Safari reports a Mac; only the touch screen tells them apart. */
	maxTouchPoints: number;
}

type Pattern = readonly [RegExp, string];

/** First match wins: Edge and Chrome on iOS also say "Safari", Edge also says "Chrome". */
const BROWSERS: readonly Pattern[] = [
	[/Edg(e|A|iOS)?\//u, "Edge"],
	[/Firefox\/|FxiOS\//u, "Firefox"],
	[/Chrome\/|CriOS\//u, "Chrome"],
	[/Safari\//u, "Safari"],
];

const DEVICES: readonly Pattern[] = [
	[/iPhone|iPod/u, "iPhone"],
	[/iPad/u, "iPad"],
	[/Android/u, "Android"],
	[/CrOS/u, "ChromeOS"],
	[/Macintosh|Mac OS X/u, "Mac"],
	[/Windows/u, "Windows"],
	[/Linux/u, "Linux"],
];

/** Said when neither the browser nor the device is recognised. */
const FALLBACK_NAME = "Memoria";

function firstMatch(patterns: readonly Pattern[], text: string): string | null {
	return patterns.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function deviceOf({ userAgent, maxTouchPoints }: DeviceHints): string | null {
	const device = firstMatch(DEVICES, userAgent);
	return device === "Mac" && maxTouchPoints > 1 ? "iPad" : device;
}

/** "Safari · iPhone", or whichever half is known. */
export function deviceName(hints: DeviceHints): string {
	const parts = [firstMatch(BROWSERS, hints.userAgent), deviceOf(hints)];
	const known = parts.filter((part): part is string => part !== null);
	return known.length > 0 ? known.join(" · ") : FALLBACK_NAME;
}

function browserHints(): DeviceHints {
	if (typeof navigator === "undefined")
		return { userAgent: "", maxTouchPoints: 0 };
	return {
		userAgent: navigator.userAgent,
		maxTouchPoints: navigator.maxTouchPoints ?? 0,
	};
}

/** The user this window announces in the live document of `clientId`. */
export function localPresenceUser(clientId: number): VaultCollabUser {
	return { name: deviceName(browserHints()), color: clientColor(clientId) };
}
