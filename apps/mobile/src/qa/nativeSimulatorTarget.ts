export type BootedNativeSimulator = {
	udid: string;
};

export function resolveNativeSimulatorId(
	requestedId: string | undefined,
	bootedDevices: readonly BootedNativeSimulator[],
	requiresExplicitId: boolean,
): string {
	if (requestedId) {
		if (!bootedDevices.some((device) => device.udid === requestedId)) {
			throw new Error(`Selected simulator ${requestedId} is not booted.`);
		}
		return requestedId;
	}

	if (requiresExplicitId) {
		throw new Error(
			"Large native Git fixtures require --device <booted disposable simulator UDID>.",
		);
	}

	const firstBootedDevice = bootedDevices[0];
	if (!firstBootedDevice) throw new Error("No booted iOS Simulator found.");
	return firstBootedDevice.udid;
}
