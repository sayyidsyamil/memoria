export function installFixtureVaultDesktopBridgeInBrowser(): void {
	const dispatchBrowserMenuCommand =
		window.__laputaTest?.dispatchBrowserMenuCommand ??
		(() => {
			throw new Error(
				"Memoria test bridge is missing dispatchBrowserMenuCommand",
			);
		});

	const specialHandlers: Record<
		string,
		(args?: Record<string, unknown>) => unknown
	> = {
		trigger_menu_command: (args) => {
			dispatchBrowserMenuCommand(String(args?.id ?? ""));
			return null;
		},
	};

	const decodeByteSave = (
		args: Uint8Array,
		options?: { headers?: Record<string, string> },
	): Record<string, unknown> => {
		const encodedPath = options?.headers?.["x-memoria-note-path"] ?? "";
		const pathBytes = Uint8Array.from(atob(encodedPath), (character) =>
			character.charCodeAt(0),
		);
		const decoder = new TextDecoder("utf-8", { fatal: true });
		return {
			path: decoder.decode(pathBytes),
			content: decoder.decode(args),
		};
	};

	const invoke = (
		command: string,
		args?: Record<string, unknown> | Uint8Array,
		options?: { headers?: Record<string, string> },
	): unknown => {
		if (command === "save_note_content_bytes" && args instanceof Uint8Array) {
			return invoke("save_note_content", decodeByteSave(args, options));
		}
		if (args instanceof Uint8Array)
			throw new Error(`Unexpected byte body: ${command}`);
		const handler =
			specialHandlers[command] ?? window.__mockHandlers?.[command];
		if (!handler) throw new Error(`Unhandled invoke: ${command}`);
		return handler(args);
	};

	Object.defineProperty(window, "__TAURI__", {
		configurable: true,
		value: {},
	});
	Object.defineProperty(window, "__TAURI_INTERNALS__", {
		configurable: true,
		value: { invoke },
	});
}
