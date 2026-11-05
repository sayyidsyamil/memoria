import { describe, expect, it } from "vitest";
import {
	type BootedNativeSimulator,
	resolveNativeSimulatorId,
} from "./nativeSimulatorTarget";

const devices: BootedNativeSimulator[] = [
	{ udid: "disposable-phone" },
	{ udid: "disposable-tablet" },
];

describe("resolveNativeSimulatorId", () => {
	it("requires an explicit simulator for large fixtures even when one is booted", () => {
		expect(() =>
			resolveNativeSimulatorId(undefined, devices.slice(0, 1), true),
		).toThrow("Large native Git fixtures require --device");
	});

	it("targets the requested booted simulator when more than one is available", () => {
		expect(resolveNativeSimulatorId("disposable-tablet", devices, true)).toBe(
			"disposable-tablet",
		);
	});

	it("rejects a requested simulator that is not booted", () => {
		expect(() =>
			resolveNativeSimulatorId("unknown-device", devices, false),
		).toThrow("Selected simulator unknown-device is not booted");
	});

	it("keeps the first-booted default for small fixtures", () => {
		expect(resolveNativeSimulatorId(undefined, devices, false)).toBe(
			"disposable-phone",
		);
	});

	it("requires a booted simulator for small fixtures too", () => {
		expect(() => resolveNativeSimulatorId(undefined, [], false)).toThrow(
			"No booted iOS Simulator found",
		);
	});
});
