import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	MEMORIA_DISCORD_INVITE_URL,
	MEMORIA_IOS_DOWNLOAD_URL,
} from "../constants/feedback";
import type { UpdateActions } from "../hooks/useUpdater";
import { openExternalUrl } from "../utils/url";
import { UpdateBanner } from "./UpdateBanner";

vi.mock("../hooks/useUpdater", async () => {
	const actual = await vi.importActual<typeof import("../hooks/useUpdater")>(
		"../hooks/useUpdater",
	);
	return { ...actual, restartApp: vi.fn() };
});
vi.mock("../utils/url", () => ({ openExternalUrl: vi.fn() }));

const values = new Map<string, string>();
const actions: UpdateActions = {
	startDownload: vi.fn(),
	openReleaseNotes: vi.fn(),
	dismiss: vi.fn(),
};
let appShell: HTMLDivElement;

beforeEach(() => {
	appShell = document.createElement("div");
	appShell.className = "app-shell";
	document.body.appendChild(appShell);
	values.clear();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	});
});

afterEach(() => appShell.remove());

describe("community banner", () => {
	it("shows while idle and keeps dismissal across remounts", () => {
		const first = render(
			<UpdateBanner status={{ state: "idle" }} actions={actions} />,
		);
		fireEvent.click(screen.getByTestId("community-banner-dismiss"));
		expect(screen.queryByTestId("community-banner")).not.toBeInTheDocument();
		first.unmount();
		render(<UpdateBanner status={{ state: "idle" }} actions={actions} />);
		expect(screen.queryByTestId("community-banner")).not.toBeInTheDocument();
	});

	it("keeps the floating launcher clear of stacked banners", () => {
		const view = render(
			<UpdateBanner status={{ state: "checking" }} actions={actions} />,
		);
		expect(
			appShell.style.getPropertyValue("--ai-workspace-floating-button-bottom"),
		).toBe("124px");
		fireEvent.click(screen.getByTestId("community-banner-dismiss"));
		expect(
			appShell.style.getPropertyValue("--ai-workspace-floating-button-bottom"),
		).toBe("80px");
		view.rerender(
			<UpdateBanner status={{ state: "idle" }} actions={actions} />,
		);
		expect(
			appShell.style.getPropertyValue("--ai-workspace-floating-button-bottom"),
		).toBe("2.75rem");
	});

	it("stacks update above the community banner", () => {
		render(<UpdateBanner status={{ state: "checking" }} actions={actions} />);
		expect(screen.getByTestId("update-banner")).toBeInTheDocument();
		expect(screen.getByTestId("community-banner")).toBeInTheDocument();
		expect(
			screen
				.getByTestId("update-banner")
				.compareDocumentPosition(screen.getByTestId("community-banner")) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("opens the iOS and Discord links from their respective buttons", () => {
		render(<UpdateBanner status={{ state: "idle" }} actions={actions} />);
		fireEvent.click(screen.getByTestId("community-banner-ios"));
		fireEvent.click(screen.getByRole("button", { name: "Join Discord" }));
		expect(openExternalUrl).toHaveBeenNthCalledWith(
			1,
			MEMORIA_IOS_DOWNLOAD_URL,
		);
		expect(openExternalUrl).toHaveBeenNthCalledWith(
			2,
			MEMORIA_DISCORD_INVITE_URL,
		);
	});
});
