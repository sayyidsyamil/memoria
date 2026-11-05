import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveMobileDevVaultPath } from "./mobileDevVaultPath";

describe("resolveMobileDevVaultPath", () => {
	it("asks for an explicit path instead of selecting a personal vault", () => {
		expect(() => resolveMobileDevVaultPath({})).toThrow(
			"Set MOBILE_DEV_VAULT_PATH or MOBILE_QA_VAULT_PATH, for example: MOBILE_DEV_VAULT_PATH=/path/to/vault pnpm mobile:dev-vault",
		);
	});

	it("prefers the dev path while retaining the QA fallback", () => {
		expect(
			resolveMobileDevVaultPath({ devVaultPath: "/dev", qaVaultPath: "/qa" }),
		).toBe("/dev");
		expect(resolveMobileDevVaultPath({ qaVaultPath: "/qa" })).toBe("/qa");
	});

	it("reports missing configuration from the dev-vault launcher", () => {
		const environment = { ...process.env };
		delete environment.MOBILE_DEV_VAULT_PATH;
		delete environment.MOBILE_QA_VAULT_PATH;

		expect(() =>
			execFileSync(
				process.execPath,
				[fileURLToPath(new URL("../../scripts/serve-local-vault.mjs", import.meta.url))],
				{ encoding: "utf8", env: environment, timeout: 10_000 },
			),
		).toThrow("Set MOBILE_DEV_VAULT_PATH or MOBILE_QA_VAULT_PATH");
	});
});
