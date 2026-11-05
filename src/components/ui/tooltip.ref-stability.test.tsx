import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Tooltip, TooltipProvider, TooltipTrigger } from "./tooltip";

function SidebarAction({
	label,
	triggerRef,
}: {
	label: string;
	triggerRef: (node: HTMLSpanElement | null) => void;
}) {
	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<span ref={triggerRef}>
						<button type="button">{label}</button>
					</span>
				</TooltipTrigger>
			</Tooltip>
		</TooltipProvider>
	);
}

describe("sidebar tooltip trigger stability", () => {
	it("keeps the same anchor attached when note updates rerender its action", () => {
		const triggerRef = vi.fn();
		const { rerender } = render(
			<SidebarAction label="Go Back" triggerRef={triggerRef} />,
		);
		const trigger = screen.getByRole("button", {
			name: "Go Back",
		}).parentElement;
		expect(triggerRef).toHaveBeenLastCalledWith(trigger);
		triggerRef.mockClear();

		rerender(
			<SidebarAction label="Go Back after editing" triggerRef={triggerRef} />,
		);

		expect(
			screen.getByRole("button", { name: "Go Back after editing" })
				.parentElement,
		).toBe(trigger);
		expect(triggerRef).not.toHaveBeenCalled();
	});
});
