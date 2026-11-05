type MobileDevVaultPathConfiguration = {
	devVaultPath?: string;
	qaVaultPath?: string;
};

export function resolveMobileDevVaultPath({
	devVaultPath,
	qaVaultPath,
}: MobileDevVaultPathConfiguration): string {
	const vaultPath = devVaultPath || qaVaultPath;
	if (vaultPath) return vaultPath;

	throw new Error(
		"Set MOBILE_DEV_VAULT_PATH or MOBILE_QA_VAULT_PATH, for example: MOBILE_DEV_VAULT_PATH=/path/to/vault pnpm mobile:dev-vault",
	);
}
