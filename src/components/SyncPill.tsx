import {
	ArrowsClockwise,
	CheckCircle,
	CloudSlash,
	type IconProps,
	Warning,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { isSyncPillBusy, type SyncPillState } from "./status-bar/syncPillState";
import { Badge } from "./ui/badge";

const ICONS = new Map<SyncPillState, (props: IconProps) => ReactNode>([
	["connecting", (props) => <ArrowsClockwise {...props} />],
	["syncing", (props) => <ArrowsClockwise {...props} />],
	["synced", (props) => <CheckCircle {...props} />],
	["offline", (props) => <CloudSlash {...props} />],
	["conflict", (props) => <Warning {...props} />],
]);

/** IconProps leaves data attributes out; the icon still takes them. */
const ICON_TEST_ID = { "data-testid": "sync-pill-icon" } as IconProps;

const TONES = new Map<SyncPillState, string>([
	["offline", "bg-[var(--feedback-error-bg)] text-[var(--destructive)]"],
	["conflict", "text-[var(--accent-orange)]"],
]);

interface SyncPillProps {
	state: SyncPillState;
	label: string;
	description: string;
	testId?: string;
	/** The underlying status, when it says more than the pill state (the collab surface). */
	status?: string;
	className?: string;
	/** The vault cannot be edited meanwhile (offline on the web). */
	readOnly?: boolean;
}

/**
 * Connection and sync state as one pill. Its icon spins while connecting or syncing: the
 * only sync indicator, so nothing over the note list or the editor shows background work.
 */
export function SyncPill({
	state,
	label,
	description,
	testId = "sync-pill",
	status = state,
	className,
	readOnly = false,
}: SyncPillProps) {
	const renderIcon = ICONS.get(state) ?? ICONS.get("synced");
	const busy = isSyncPillBusy(state);
	return (
		<Badge
			variant="secondary"
			className={cn("sync-pill gap-1 text-[12px]", TONES.get(state), className)}
			role="status"
			title={description}
			aria-busy={busy || undefined}
			data-state={state}
			data-status={status}
			data-read-only={readOnly || undefined}
			data-testid={testId}
		>
			{renderIcon?.({
				size: 12,
				weight: "bold",
				"aria-hidden": true,
				className: cn(busy && "animate-spin"),
				...ICON_TEST_ID,
			})}
			{label}
		</Badge>
	);
}
