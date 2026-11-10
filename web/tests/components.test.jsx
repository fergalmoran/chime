import { expect, test } from "bun:test";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installNotificationApi, removeNotificationApi } from "./notification-api.js";

// GOOGLE_CLIENT_ID is read from import.meta.env when lib/api loads.
process.env.VITE_GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
const { currentPath, renderPage, signIn } = await import("./render.jsx");
const { SignInButton } = await import("../src/components/sign-in-button.tsx");
const { SiteHeader } = await import("../src/components/site-header.tsx");
const { SiteFooter } = await import("../src/components/site-footer.tsx");
const { LandingPage } = await import("../src/components/landing-page.tsx");
const { DesktopNotifications } = await import("../src/components/desktop-notifications.tsx");
const { DESKTOP_NOTIFICATIONS_KEY } = await import("../src/lib/desktop-notifications.ts");

function captureRedirects() {
	const assigned = [];
	window.location.assign = (url) => assigned.push(new URL(String(url)));
	return assigned;
}

// --- Sign in -----------------------------------------------------------------------------------------------

test("Sign in sends the user to Google and remembers where to come back to", async () => {
	const user = userEvent.setup();
	const redirects = captureRedirects();
	render(<SignInButton returnTo="/settings" />);

	const button = screen.getByRole("button", { name: "Sign in" });
	expect(button.disabled).toBe(false);
	await user.click(button);

	expect(redirects).toHaveLength(1);
	expect(redirects[0].host).toBe("accounts.google.com");
	expect(redirects[0].searchParams.get("client_id")).toBe(process.env.VITE_GOOGLE_CLIENT_ID);
	expect(JSON.parse(sessionStorage.getItem("chime.google-sign-in")).returnTo).toBe("/settings");
});

test("Sign in accepts custom text and button props", () => {
	render(
		<SignInButton size="lg" className="extra">
			Try again
		</SignInButton>,
	);
	const button = screen.getByRole("button", { name: "Try again" });
	expect(button.className).toContain("extra");
});

// --- Header ------------------------------------------------------------------------------------------------

test("the header offers Sign in when signed out", async () => {
	await renderPage(SiteHeader);
	expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
	expect(screen.getByRole("link", { name: /Chime/ }).getAttribute("href")).toBe("/");
});

test("Log out clears the session, goes home and swaps the button back to Sign in", async () => {
	const user = userEvent.setup();
	signIn();
	// The header lives in the layout, so it's still there after navigating home.
	const { router } = await renderPage(() => <p>Devices</p>, {
		path: "/devices",
		shell: (outlet) => (
			<>
				<SiteHeader />
				{outlet}
			</>
		),
	});

	await user.click(screen.getByRole("button", { name: "Log out" }));

	expect(localStorage.getItem("chime.tokens")).toBeNull();
	await waitFor(() => expect(currentPath(router)).toBe("/"));
	expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
});

test("the header includes the theme toggle", async () => {
	await renderPage(SiteHeader);
	expect(screen.getByRole("button", { name: /Switch to (dark|light) mode/ })).toBeTruthy();
});

// --- Footer ------------------------------------------------------------------------------------------------

test("the footer always links to the privacy policy, with the current year", async () => {
	await renderPage(SiteFooter);
	expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
	expect(screen.getByText(`© ${new Date().getFullYear()} Chime`)).toBeTruthy();
	expect(screen.queryByRole("link", { name: "Delete account" })).toBeNull();
});

test("signed in, the footer links straight to account deletion in Settings", async () => {
	signIn();
	await renderPage(SiteFooter);
	expect(screen.getByRole("link", { name: "Delete account" }).getAttribute("href")).toBe(
		"/settings#delete-account",
	);
});

test("the footer's delete link disappears on sign-out", async () => {
	signIn();
	await renderPage(SiteFooter);
	act(() => localStorage.removeItem("chime.tokens"));
	const { authStore } = await import("../src/lib/api.ts");
	act(() => authStore.logout());
	expect(screen.queryByRole("link", { name: "Delete account" })).toBeNull();
});

// --- Landing page ------------------------------------------------------------------------------------------

test("the landing page pitches Chime and offers sign-in", () => {
	render(<LandingPage />);
	expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
		"Your phone's notifications, on your desktop.",
	);
	for (const feature of ["Every message, one place", "Real-time", "You're in control"]) {
		expect(screen.getByText(feature)).toBeTruthy();
	}
	expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
});

// --- Desktop notifications toggle ---------------------------------------------------------------------------

const toggleButton = () => screen.getByRole("button", { name: /desktop notifications/ });

test("without the Notification API the toggle is disabled and explains why", () => {
	removeNotificationApi();
	render(<DesktopNotifications />);
	expect(toggleButton().disabled).toBe(true);
	expect(screen.getByText(/need a supported browser and HTTPS/)).toBeTruthy();
});

test("enabling asks for permission and, once granted, opts in", async () => {
	const user = userEvent.setup();
	const api = installNotificationApi("default", { requestResult: "granted" });
	render(<DesktopNotifications />);

	expect(toggleButton().textContent).toBe("Enable desktop notifications");
	await user.click(toggleButton());

	expect(api.requests).toBe(1);
	expect(localStorage.getItem(DESKTOP_NOTIFICATIONS_KEY)).toBe("true");
	expect(toggleButton().textContent).toBe("Disable desktop notifications");
});

test("disabling opts out without touching the browser permission", async () => {
	const user = userEvent.setup();
	const api = installNotificationApi("granted");
	localStorage.setItem(DESKTOP_NOTIFICATIONS_KEY, "true");
	render(<DesktopNotifications />);

	await user.click(toggleButton());

	expect(api.requests).toBe(0);
	expect(localStorage.getItem(DESKTOP_NOTIFICATIONS_KEY)).toBeNull();
	expect(toggleButton().textContent).toBe("Enable desktop notifications");
});

test("declining the permission prompt leaves alerts off and says they're blocked", async () => {
	const user = userEvent.setup();
	installNotificationApi("default", { requestResult: "denied" });
	render(<DesktopNotifications />);

	await user.click(toggleButton());

	expect(localStorage.getItem(DESKTOP_NOTIFICATIONS_KEY)).toBeNull();
	expect(toggleButton().disabled).toBe(true);
	expect(screen.getByText(/Notifications are blocked/)).toBeTruthy();
});

test("dismissing the prompt (still 'default') leaves alerts off but the button usable", async () => {
	const user = userEvent.setup();
	installNotificationApi("default", { requestResult: "default" });
	render(<DesktopNotifications />);

	await user.click(toggleButton());

	expect(localStorage.getItem(DESKTOP_NOTIFICATIONS_KEY)).toBeNull();
	expect(toggleButton().disabled).toBe(false);
});

test("a permission request that throws shows the error", async () => {
	const user = userEvent.setup();
	installNotificationApi("default", { requestError: new Error("Permission request blocked") });
	render(<DesktopNotifications />);

	await user.click(toggleButton());

	expect(screen.getByRole("alert").textContent).toBe("Permission request blocked");
});

test("an opt-in left over from before permission was revoked isn't shown as on", () => {
	installNotificationApi("default");
	localStorage.setItem(DESKTOP_NOTIFICATIONS_KEY, "true");
	render(<DesktopNotifications />);
	expect(toggleButton().textContent).toBe("Enable desktop notifications");
});

test("returning to the tab picks up permission changed in browser settings", () => {
	const api = installNotificationApi("granted");
	localStorage.setItem(DESKTOP_NOTIFICATIONS_KEY, "true");
	render(<DesktopNotifications />);
	expect(toggleButton().textContent).toBe("Disable desktop notifications");

	api.Notification.permission = "denied";
	act(() => window.dispatchEvent(new Event("focus")));

	expect(toggleButton().disabled).toBe(true);
	expect(screen.getByText(/Notifications are blocked/)).toBeTruthy();
});

test("opting out in another tab is reflected here", () => {
	installNotificationApi("granted");
	localStorage.setItem(DESKTOP_NOTIFICATIONS_KEY, "true");
	render(<DesktopNotifications />);

	localStorage.removeItem(DESKTOP_NOTIFICATIONS_KEY);
	act(() => window.dispatchEvent(new Event("storage")));

	expect(toggleButton().textContent).toBe("Enable desktop notifications");
});
