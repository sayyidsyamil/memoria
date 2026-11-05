import { useAppLocale } from "../hooks/useAppPreferences";
import { isConflictCopyPath } from "../lib/conflictCopyPaths";
import { translate } from "../lib/i18n";
import { isRemoteBrowserShell } from "./status-bar/syncPillState";

/** Marks a conflict copy the Memoria server kept, in the web build's note list. */
export function ConflictCopyBadge({ path }: { path: string }) {
	const locale = useAppLocale();
	if (!isConflictCopyPath(path) || !isRemoteBrowserShell()) return null;
	return (
		<span
			className="ml-1.5 inline-block rounded px-1 align-middle text-[9px] font-medium text-[var(--accent-orange)]"
			style={{ background: "var(--muted)" }}
			data-testid="conflict-copy-badge"
		>
			{translate(locale, "noteList.conflictCopyBadge")}
		</span>
	);
}
