import { Warning } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { fileNameOf } from "../../lib/conflictCopyPaths";
import { type AppLocale, translate } from "../../lib/i18n";
import { trackEvent } from "../../lib/telemetry";
import { requestVaultEntriesReload } from "../../lib/vaultEntriesStale";
import { Button } from "../ui/button";

/**
 * The conflict copy the server announced that has not been dismissed yet. A new copy is a
 * new file in the vault: the note list is reloaded so it shows up there, marked.
 */
function useConflictCopyNotice(conflictCopy: string | undefined) {
	const [dismissed, setDismissed] = useState<string | null>(null);
	useEffect(() => {
		if (conflictCopy === undefined) return;
		requestVaultEntriesReload();
		trackEvent("web_conflict_copy_notice_shown");
	}, [conflictCopy]);
	const visible = conflictCopy !== dismissed ? conflictCopy : undefined;
	const dismiss = () => {
		setDismissed(conflictCopy ?? null);
		trackEvent("web_conflict_copy_notice_dismissed");
	};
	return { visible, dismiss };
}

interface ConflictCopyNoticeProps {
	conflictCopy: string | undefined;
	locale: AppLocale;
}

/** Tells the people editing a note that a change from elsewhere was kept as a conflict copy. */
export function ConflictCopyNotice({
	conflictCopy,
	locale,
}: ConflictCopyNoticeProps) {
	const { visible, dismiss } = useConflictCopyNotice(conflictCopy);
	if (visible === undefined) return null;
	return (
		<div
			className={cn(
				"fixed bottom-12 left-1/2 z-[1095] flex max-w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 items-start gap-2 rounded-lg",
				"border border-[var(--border)] bg-[var(--bg-dialog)] px-4 py-3 text-[13px] text-foreground",
				"shadow-[0_4px_16px_var(--shadow-dialog)] animate-in slide-in-from-bottom-2 fade-in duration-200",
			)}
			role="alert"
			data-testid="conflict-copy-notice"
		>
			<Warning
				size={16}
				className="mt-0.5 shrink-0 text-[var(--accent-orange)]"
			/>
			<div className="flex min-w-0 flex-col gap-0.5">
				<span className="font-medium">
					{translate(locale, "collab.conflictNotice.title")}
				</span>
				<span className="text-muted-foreground">
					{translate(locale, "collab.conflictCopy", {
						file: fileNameOf(visible),
					})}
				</span>
			</div>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="ml-2 shrink-0"
				onClick={dismiss}
				data-testid="conflict-copy-notice-dismiss"
			>
				{translate(locale, "collab.conflictNotice.close")}
			</Button>
		</div>
	);
}
