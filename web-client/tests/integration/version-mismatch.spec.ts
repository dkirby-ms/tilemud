import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VersionMismatchBanner from "../../src/components/VersionMismatchBanner";
import { useSessionStore } from "../../src/features/session/sessionStore";
import { eventVersionMismatchSchema } from "../../src/types";

describe("Integration: version mismatch UX", () => {
	beforeEach(() => {
		useSessionStore.getState().reset();
	});

	it("surfaces update banner and triggers reload action on demand", async () => {
		const mismatch = eventVersionMismatchSchema.parse({
			type: "event.version_mismatch",
			payload: {
				expectedVersion: "5.0.0",
				receivedVersion: "4.9.1",
				message: "A newer build is available"
			}
		});

		useSessionStore.getState().handleVersionMismatch(mismatch);

		const reloadSpy = vi.fn();
		render(createElement(VersionMismatchBanner, { onReload: reloadSpy }));

		expect(screen.getByTestId("version-mismatch-banner")).toBeInTheDocument();
		expect(screen.getByText(/Update Required/i)).toBeVisible();
		expect(screen.getByTestId("server-version").textContent).toBe("5.0.0");

		await userEvent.click(screen.getByTestId("version-mismatch-reload"));

		expect(reloadSpy).toHaveBeenCalledTimes(1);
		expect(useSessionStore.getState().status).toBe("connecting");
		expect(screen.queryByTestId("version-mismatch-banner")).not.toBeInTheDocument();
	});
});
