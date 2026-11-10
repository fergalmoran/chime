import { expect, mock, test } from "bun:test";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { installNotificationApi } from "./notification-api.js";
import { newQueryClient, signIn } from "./render.jsx";

// A scriptable SignalR hub: the test fires server events and controls when start() settles.
const hub = { connections: [], startResult: "ok" };
mock.module("@microsoft/signalr", () => ({
	LogLevel: { Warning: 3 },
	HubConnectionBuilder: class {
		withUrl(url, options) {
			this.url = url;
			this.options = options;
			return this;
		}
		withAutomaticReconnect() {
			this.reconnect = true;
			return this;
		}
		configureLogging() {
			return this;
		}
		build() {
			const conn = {
				url: this.url,
				options: this.options,
				reconnect: this.reconnect,
				handlers: {},
				stopped: 0,
				on(name, fn) {
					this.handlers[name] = fn;
				},
				start: () => (hub.startResult === "ok" ? Promise.resolve() : Promise.reject(new Error(hub.startResult))),
				async stop() {
					this.stopped++;
				},
			};
			hub.connections.push(conn);
			return conn;
		}
	},
}));

const { QueryClientProvider } = await import("@tanstack/react-query");
const { authStore, api } = await import("../src/lib/api.ts");
const { notificationsKey, useIsAuthenticated, useLiveNotifications } = await import("../src/lib/hooks.ts");
const { DESKTOP_NOTIFICATIONS_KEY } = await import("../src/lib/desktop-notifications.ts");

const item = (id, extra = {}) => ({
	id,
	sourceDeviceId: null,
	appId: "com.whatsapp",
	appName: "WhatsApp",
	category: "Message",
	title: `Title ${id}`,
	body: `Body ${id}`,
	postedAt: "2026-11-01T12:00:00Z",
	receivedAt: "2026-11-01T12:00:00Z",
	dismissedAt: null,
	...extra,
});

function renderLive(queryClient = newQueryClient()) {
	hub.connections.length = 0;
	const wrapper = ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	const utils = renderHook(() => useLiveNotifications(), { wrapper });
	return { queryClient, conn: hub.connections[0], ...utils };
}

const feed = (queryClient) => queryClient.getQueryData(notificationsKey)?.items.map((n) => n.id);

// --- useIsAuthenticated ---------------------------------------------------------------------------------

test("useIsAuthenticated follows sign-in and sign-out without a reload", async () => {
	const { result } = renderHook(() => useIsAuthenticated());
	expect(result.current).toBe(false);

	globalThis.fetch = async () =>
		new Response(JSON.stringify({ accessToken: "a", refreshToken: "r", expiresIn: 3600 }), {
			headers: { "Content-Type": "application/json" },
		});
	await act(() => api.loginWithGoogle("token"));
	expect(result.current).toBe(true);

	act(() => authStore.logout());
	expect(result.current).toBe(false);
});

test("useIsAuthenticated reads tokens that were already stored", () => {
	signIn();
	const { result } = renderHook(() => useIsAuthenticated());
	expect(result.current).toBe(true);
});

// --- useLiveNotifications --------------------------------------------------------------------------------

test("connects to the API hub with a fresh access token and automatic reconnect", async () => {
	signIn("live-token");
	const { conn } = renderLive();

	expect(conn.url).toEndWith("/api/hubs/notifications");
	expect(conn.reconnect).toBe(true);
	expect(await conn.options.accessTokenFactory()).toBe("live-token");
});

test("signed out, the hub gets an empty token rather than a crash", async () => {
	const { conn } = renderLive();
	expect(await conn.options.accessTokenFactory()).toBe("");
});

test("a new notification is added to the top of the feed without duplicates", () => {
	const { queryClient, conn } = renderLive();
	queryClient.setQueryData(notificationsKey, { items: [item("a"), item("b")], nextBefore: null });

	act(() => conn.handlers.NotificationReceived(item("c")));
	expect(feed(queryClient)).toEqual(["c", "a", "b"]);

	act(() => conn.handlers.NotificationReceived(item("a", { title: "updated" })));
	expect(feed(queryClient)).toEqual(["a", "c", "b"]);
	expect(queryClient.getQueryData(notificationsKey).items[0].title).toBe("updated");
});

test("a dismissal elsewhere removes the notification from the feed", () => {
	const { queryClient, conn } = renderLive();
	queryClient.setQueryData(notificationsKey, { items: [item("a"), item("b")], nextBefore: "cursor" });

	act(() => conn.handlers.NotificationDismissed("a"));

	expect(feed(queryClient)).toEqual(["b"]);
	expect(queryClient.getQueryData(notificationsKey).nextBefore).toBe("cursor");
});

test("events before the feed has loaded don't invent a feed", () => {
	const { queryClient, conn } = renderLive();

	act(() => {
		conn.handlers.NotificationReceived(item("a"));
		conn.handlers.NotificationDismissed("a");
	});

	expect(queryClient.getQueryData(notificationsKey)).toBeUndefined();
});

test("handlers return nothing, so SignalR doesn't treat them as client results", () => {
	const { queryClient, conn } = renderLive();
	queryClient.setQueryData(notificationsKey, { items: [], nextBefore: null });
	expect(conn.handlers.NotificationReceived(item("a"))).toBeUndefined();
	expect(conn.handlers.NotificationDismissed("a")).toBeUndefined();
});

test("a new notification raises a desktop alert when the user has opted in", () => {
	const notifications = installNotificationApi("granted");
	localStorage.setItem(DESKTOP_NOTIFICATIONS_KEY, "true");
	const { conn } = renderLive();

	act(() => conn.handlers.NotificationReceived(item("a")));

	expect(notifications.shown.map((n) => n.title)).toEqual(["Title a"]);
});

test("unmounting stops the connection once it has started", async () => {
	const { conn, unmount } = renderLive();
	unmount();
	await waitFor(() => expect(conn.stopped).toBe(1));
});

test("an unreachable hub is logged and the page keeps working", async () => {
	hub.startResult = "offline";
	const warn = console.warn;
	const warnings = [];
	console.warn = (...args) => warnings.push(args);
	try {
		const { conn, unmount } = renderLive();
		await waitFor(() => expect(warnings[0]?.[0]).toBe("Live updates unavailable"));
		unmount();
		await waitFor(() => expect(conn.stopped).toBe(1));
	} finally {
		console.warn = warn;
		hub.startResult = "ok";
	}
});

test("a component using the hook re-renders with live arrivals", () => {
	const queryClient = newQueryClient();
	queryClient.setQueryData(notificationsKey, { items: [], nextBefore: null });
	hub.connections.length = 0;
	function Feed() {
		useLiveNotifications();
		const items = queryClient.getQueryData(notificationsKey)?.items ?? [];
		return <p>{items.length} live</p>;
	}
	const { rerender, getByText } = render(
		<QueryClientProvider client={queryClient}>
			<Feed />
		</QueryClientProvider>,
	);

	act(() => hub.connections[0].handlers.NotificationReceived(item("a")));
	rerender(
		<QueryClientProvider client={queryClient}>
			<Feed />
		</QueryClientProvider>,
	);

	expect(getByText("1 live")).toBeTruthy();
});
