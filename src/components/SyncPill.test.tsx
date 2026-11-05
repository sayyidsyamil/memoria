import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SyncPill } from "./SyncPill";

describe("SyncPill", () => {
	it("spins its icon while syncing", () => {
		render(
			<SyncPill
				state="syncing"
				label="Syncing…"
				description="Sync in progress"
			/>,
		);

		const pill = screen.getByRole("status");
		expect(pill).toHaveTextContent("Syncing…");
		expect(pill).toHaveAttribute("title", "Sync in progress");
		expect(pill).toHaveAttribute("aria-busy", "true");
		expect(pill).toHaveAttribute("data-state", "syncing");
		expect(screen.getByTestId("sync-pill-icon")).toHaveClass("animate-spin");
	});

	it("keeps the icon still once synced, and reports the underlying status", () => {
		render(
			<SyncPill
				state="synced"
				label="Synced"
				description="All changes synced"
				status="synced-detail"
				testId="custom-pill"
			/>,
		);

		const pill = screen.getByTestId("custom-pill");
		expect(pill).not.toHaveAttribute("aria-busy");
		expect(pill).toHaveAttribute("data-status", "synced-detail");
		expect(screen.getByTestId("sync-pill-icon")).not.toHaveClass(
			"animate-spin",
		);
	});
});
