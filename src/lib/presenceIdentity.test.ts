import { afterEach, describe, expect, it, vi } from "vitest";
import { PRESENCE_COLORS } from "../../packages/collab-client/src/presence";
import { deviceName, localPresenceUser } from "./presenceIdentity";

const IPHONE_SAFARI =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const MAC_SAFARI =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const LINUX_HEADLESS_CHROME =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36";
const WINDOWS_EDGE =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
const IPHONE_CHROME =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1";
const ANDROID_FIREFOX =
	"Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("deviceName", () => {
	it.each([
		[IPHONE_SAFARI, 0, "Safari · iPhone"],
		[MAC_SAFARI, 0, "Safari · Mac"],
		[MAC_SAFARI, 5, "Safari · iPad"],
		[LINUX_HEADLESS_CHROME, 0, "Chrome · Linux"],
		[WINDOWS_EDGE, 0, "Edge · Windows"],
		[IPHONE_CHROME, 5, "Chrome · iPhone"],
		[ANDROID_FIREFOX, 5, "Firefox · Android"],
		["SomeBot/1.0 (Windows)", 0, "Windows"],
		["Mozilla/5.0 Safari/1.0", 0, "Safari"],
		["", 0, "Memoria"],
	])("names %j with %i touch points %j", (userAgent, maxTouchPoints, name) => {
		expect(deviceName({ userAgent, maxTouchPoints })).toBe(name);
	});
});

describe("localPresenceUser", () => {
	it("names this browser and colours the document's client", () => {
		vi.stubGlobal("navigator", {
			userAgent: IPHONE_SAFARI,
			maxTouchPoints: 5,
		});

		expect(localPresenceUser(3)).toEqual({
			name: "Safari · iPhone",
			color: PRESENCE_COLORS[3],
		});
	});

	it("still names the window without a navigator", () => {
		vi.stubGlobal("navigator", undefined);

		expect(localPresenceUser(0).name).toBe("Memoria");
	});
});
