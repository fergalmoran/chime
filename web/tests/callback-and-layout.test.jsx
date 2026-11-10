import { expect, mock, test } from "bun:test";
import { act, render, screen, waitFor } from "@testing-library/react";

// The dashboard opens a live connection; give it a hub that never connects anywhere.
const hub = { built: 0 };
mock.module("@microsoft/signalr", () => ({
	LogLevel: { Warning: 3 },
	HubConnectionBuilder: class {
		withUrl() {
			return this;
		}
		withAutomaticReconnect() {
			return this;
		}
		configureLogging() {
			return this;
		}
		build() {
			hub.built++;
			return { on() {}, start: async () => {}, stop: async () => {} };
		}
	},
}));

process.env.VITE_GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
const { QueryClientProvider } = await import("@tanstack/react-query");
const { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } = await import(
	"@tanstack/react-router"
);
const { StrictMode } = await import("react");
const { currentPath, json, mockApi, newQueryClient, renderPage, signIn } = await import("./render.jsx");
const { Route: CallbackRoute } = await import("../src/routes/auth/callback.tsx");
const { Route: AppRoute } = await import("../src/routes/_app.tsx");

const Callback = CallbackRoute.options.component;

// --- /auth/callback -----------------------------------------------------------------------------------------

const b64url = (v) => btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Puts a pending sign-in in session storage and Google's reply in the URL fragment. */
function googleReturned({ returnTo = "/settings", stateMatches = true, error } = {}) {
	const pending = { state: "state-1", nonce: "nonce-1", returnTo };
	sessionStorage.setItem("chime.google-sign-in", JSON.stringify(pending));
	const params = error
		? new URLSearchParams({ error })
		: new URLSearchParams({
				id_token: `${b64url({ alg: "RS256" })}.${b64url({ nonce: "nonce-1" })}.sig`,
				state: stateMatches ? "state-1" : "forged",
			});
	window.history.replaceState(null, "", `/auth/callback#${params}`);
	return `/auth/callback#${params}`;
}

const signInOk = () => ({ accessToken: "a", refreshToken: "r", expiresIn: 3600 });

test("a successful Google return signs in and lands where sign-in started", async () => {
	const url = googleReturned({ returnTo: "/settings" });
	const calls = mockApi({ "POST /api/auth/google": signInOk });

	const { router } = await renderPage(Callback, { path: "/auth/callback", url });

	await waitFor(() => expect(currentPath(router)).toBe("/settings"));
	expect(calls).toHaveLength(1);
	expect(localStorage.getItem("chime.tokens")).not.toBeNull();
});

test("the ID token is scrubbed from the address bar straight away", async () => {
	const url = googleReturned();
	let release;
	mockApi({ "POST /api/auth/google": () => new Promise((r) => { release = () => r(json(200, signInOk())); }) });

	await renderPage(Callback, { path: "/auth/callback", url });

	expect(screen.getByText("Signing you in…")).toBeTruthy();
	expect(window.location.hash).toBe("");
	expect(window.location.href).not.toContain("id_token");
	release();
});

test("in StrictMode the single-use sign-in is only attempted once", async () => {
	const url = googleReturned();
	let release;
	const calls = mockApi({
		"POST /api/auth/google": () => new Promise((r) => { release = () => r(json(200, signInOk())); }),
	});
	const root = createRootRoute({ component: Outlet });
	const router = createRouter({
		routeTree: root.addChildren([
			createRoute({ getParentRoute: () => root, path: "/auth/callback", component: Callback }),
			createRoute({ getParentRoute: () => root, path: "/settings", component: () => <p>Settings page</p> }),
		]),
		history: createMemoryHistory({ initialEntries: [url] }),
	});

	await act(async () => {
		render(
			<StrictMode>
				<QueryClientProvider client={newQueryClient()}>
					<RouterProvider router={router} />
				</QueryClientProvider>
			</StrictMode>,
		);
		await router.load();
	});

	// A second run would find the pending sign-in used up and flash "could not be verified".
	expect(screen.getByText("Signing you in…")).toBeTruthy();
	expect(screen.queryByRole("alert")).toBeNull();
	release();
	await screen.findByText("Settings page");
	expect(calls).toHaveLength(1);
});

test.each([
	["the user cancels at Google", { error: "access_denied" }, "Sign-in was cancelled."],
	["the response doesn't match the sign-in we started", { stateMatches: false }, "Google sign-in response could not be verified."],
])("when %s, the error is shown with a way to try again", async (_, setup, message) => {
	const url = googleReturned(setup);
	const calls = mockApi({ "POST /api/auth/google": signInOk });

	await renderPage(Callback, { path: "/auth/callback", url });

	expect((await screen.findByRole("alert")).textContent).toBe(message);
	expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
	expect(calls).toHaveLength(0);
});

test("the API's explanation is shown when it refuses the Google account", async () => {
	const url = googleReturned();
	mockApi({
		"POST /api/auth/google": () => json(400, { title: "Bad Request", detail: "Your Google email isn't verified." }),
	});

	await renderPage(Callback, { path: "/auth/callback", url });

	expect((await screen.findByRole("alert")).textContent).toBe("Your Google email isn't verified.");
	expect(localStorage.getItem("chime.tokens")).toBeNull();
});

test("a server error without details still gives a readable message", async () => {
	const url = googleReturned();
	mockApi({ "POST /api/auth/google": () => json(503) });

	await renderPage(Callback, { path: "/auth/callback", url });

	expect((await screen.findByRole("alert")).textContent).toBe("API request failed with status 503");
});

// --- The /_app layout and its guard -------------------------------------------------------------------------

/** Mounts the real _app layout (guard + component) over stand-in pages, as in the app's route tree. */
async function renderApp(url) {
	mockApi({ "GET /api/notifications": () => ({ items: [], nextBefore: null }) });
	const root = createRootRoute({ component: Outlet });
	const layout = createRoute({
		getParentRoute: () => root,
		id: "_app",
		beforeLoad: AppRoute.options.beforeLoad,
		component: AppRoute.options.component,
	});
	const page = (path, text) => createRoute({ getParentRoute: () => layout, path, component: () => <p>{text}</p> });
	const router = createRouter({
		routeTree: root.addChildren([
			layout.addChildren([page("/", "Feed page"), page("/devices", "Devices page"), page("/settings", "Settings page")]),
		]),
		history: createMemoryHistory({ initialEntries: [url] }),
	});
	await act(async () => {
		render(
			<QueryClientProvider client={newQueryClient()}>
				<RouterProvider router={router} />
			</QueryClientProvider>,
		);
		await router.load();
	});
	return router;
}

test("signed out, the home page is the landing page with no dashboard or live connection", async () => {
	hub.built = 0;
	await renderApp("/");

	expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Your phone's notifications");
	expect(screen.queryByRole("link", { name: "Devices" })).toBeNull();
	expect(screen.queryByText("Feed page")).toBeNull();
	expect(hub.built).toBe(0);
});

test.each(["/devices", "/settings"])("signed out, %s redirects home", async (url) => {
	const router = await renderApp(url);
	await waitFor(() => expect(currentPath(router)).toBe("/"));
	expect(screen.queryByText(/Devices page|Settings page/)).toBeNull();
});

test("signed in, pages render inside the dashboard with tabs, alerts toggle and a live connection", async () => {
	signIn();
	hub.built = 0;
	await renderApp("/devices");

	expect(screen.getByText("Devices page")).toBeTruthy();
	for (const tab of ["Notifications", "Devices", "Settings"]) {
		expect(screen.getByRole("link", { name: tab })).toBeTruthy();
	}
	expect(screen.getByRole("link", { name: "Devices" }).getAttribute("href")).toBe("/devices");
	expect(screen.getByRole("region", { name: "Desktop notifications" })).toBeTruthy();
	expect(hub.built).toBe(1);
});

test("the current tab is highlighted, and only that one", async () => {
	signIn();
	await renderApp("/settings");

	const active = screen.getAllByRole("link").filter((a) => a.getAttribute("data-status") === "active");
	expect(active.map((a) => a.textContent)).toEqual(["Settings"]);
});

test("logging out swaps the dashboard for the landing page", async () => {
	signIn();
	await renderApp("/");
	expect(screen.getByText("Feed page")).toBeTruthy();

	const { authStore } = await import("../src/lib/api.ts");
	act(() => authStore.logout());

	expect(screen.queryByText("Feed page")).toBeNull();
	expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Your phone's notifications");
});

test("logging out in another browser tab signs this tab out too", async () => {
	signIn();
	await renderApp("/");
	expect(screen.getByText("Feed page")).toBeTruthy();

	// What the browser does here when another tab clears the tokens.
	localStorage.removeItem("chime.tokens");
	act(() => window.dispatchEvent(new StorageEvent("storage", { key: "chime.tokens", newValue: null })));

	expect(screen.queryByText("Feed page")).toBeNull();
	expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Your phone's notifications");
});
