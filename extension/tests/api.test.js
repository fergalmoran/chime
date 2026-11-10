import { afterEach, beforeEach, expect, mock, test } from "bun:test";

// In-memory stand-ins for WXT's storage and the browser action API.
const store = new Map();
const badge = { text: null, color: null };
mock.module("#imports", () => ({
	storage: {
		defineItem: (key, { fallback }) => ({
			getValue: async () => (store.has(key) ? store.get(key) : fallback),
			setValue: async (value) => { store.set(key, value); },
			watch: () => () => {},
		}),
	},
}));
mock.module("wxt/browser", () => ({
	browser: {
		action: {
			setBadgeText: async ({ text }) => { badge.text = text; },
			setBadgeBackgroundColor: async ({ color }) => { badge.color = color; },
		},
	},
}));

// A query string keeps this import distinct from background.test.js's mock of ../lib/api.
const api = await import("../lib/api.ts?real");

const API = "https://chime.test";
const originalFetch = globalThis.fetch;
let calls;
let routes;

function json(status, body) {
	return new Response(body === undefined ? null : JSON.stringify(body), {
		status,
		headers: body === undefined ? {} : { "Content-Type": "application/json" },
	});
}

beforeEach(() => {
	store.clear();
	calls = [];
	routes = {};
	globalThis.fetch = async (input, init = {}) => {
		const url = new URL(String(input));
		const method = init.method ?? "GET";
		const call = {
			method,
			url: url.href,
			path: url.pathname,
			auth: new Headers(init.headers).get("Authorization"),
			body: init.body ? JSON.parse(init.body) : undefined,
		};
		calls.push(call);
		const handler = routes[`${method} ${url.pathname}`];
		if (!handler) return json(404, { title: "Not Found" });
		const n = calls.filter((c) => c.path === url.pathname && c.method === method).length;
		const result = await handler(call, n);
		return result instanceof Response ? result : json(200, result);
	};
});
afterEach(() => {
	globalThis.fetch = originalFetch;
});

const tokens = (access) => ({ accessToken: access, refreshToken: `${access}-refresh`, expiresIn: 3600 });

async function signedIn({ expiresInMs = 3_600_000 } = {}) {
	await api.sessionItem.setValue({
		apiUrl: API,
		email: "me@example.com",
		accessToken: "access-1",
		refreshToken: "refresh-1",
		expiresAt: Date.now() + expiresInMs,
		deviceId: "browser-device",
	});
}

test("signing in registers this browser as a device and starts alerts from now", async () => {
	routes = {
		"POST /api/auth/google": (call) => {
			expect(call.body).toEqual({ idToken: "google-token" });
			return tokens("access-1");
		},
		"GET /api/me": (call) => ({ email: `me@example.com via ${call.auth}` }),
		"POST /api/devices": (call) => ({ id: "dev-1", ...call.body }),
	};
	const before = Date.now();

	const session = await api.loginWithGoogle(`${API}///  `.trim(), "google-token");

	expect(session.apiUrl).toBe(API);
	expect(session.deviceId).toBe("dev-1");
	expect(session.email).toBe("me@example.com via Bearer access-1");
	expect(calls.find((c) => c.path === "/api/devices").body).toEqual({ name: "Chrome extension", platform: "Browser" });
	expect(await api.sessionItem.getValue()).toEqual(session);
	expect(Date.parse(await api.lastSeenItem.getValue())).toBeGreaterThanOrEqual(before - 1);
});

test("a rejected Google sign-in surfaces the API's explanation and stores nothing", async () => {
	routes = { "POST /api/auth/google": () => json(400, { detail: "Google sign-in is not configured." }) };

	const error = await api.loginWithGoogle(API, "x").catch((e) => e);

	expect(error).toBeInstanceOf(api.ApiError);
	expect(error.message).toBe("Google sign-in is not configured.");
	expect(await api.sessionItem.getValue()).toBeNull();
});

test("requests without a session fail as signed out", async () => {
	const error = await api.fetchNotifications().catch((e) => e);
	expect(error.status).toBe(401);
	expect(error.message).toBe("Please sign in again.");
	expect(calls).toHaveLength(0);
});

test("an expiring token is refreshed and the new one is saved", async () => {
	routes = {
		"POST /api/auth/refresh": (call) => {
			expect(call.body).toEqual({ refreshToken: "refresh-1" });
			return tokens("access-2");
		},
		"GET /api/notifications": () => ({ items: [{ id: "n1" }], nextBefore: null }),
	};
	await signedIn({ expiresInMs: 5_000 });

	expect(await api.fetchNotifications()).toEqual([{ id: "n1" }]);

	expect(calls.at(-1).auth).toBe("Bearer access-2");
	const saved = await api.sessionItem.getValue();
	expect(saved.accessToken).toBe("access-2");
	expect(saved.deviceId).toBe("browser-device");
});

test("a 401 is retried once after refreshing; a failed refresh signs out", async () => {
	routes = {
		"POST /api/auth/refresh": () => tokens("access-2"),
		"POST /api/notifications/n1/dismiss": (call, n) => (n === 1 ? json(401) : json(204)),
	};
	await signedIn();
	await api.dismissNotification("n1");
	expect(calls.map((c) => c.path)).toEqual([
		"/api/notifications/n1/dismiss",
		"/api/auth/refresh",
		"/api/notifications/n1/dismiss",
	]);

	routes["POST /api/auth/refresh"] = () => json(401);
	routes["GET /api/devices"] = () => json(401);
	await api.lastSeenItem.setValue("2026-11-01T00:00:00Z");
	const error = await api.fetchMobileDevices().catch((e) => e);
	expect(error.status).toBe(401);
	expect(await api.sessionItem.getValue()).toBeNull();
	expect(await api.lastSeenItem.getValue()).toBeNull();
});

test("only Android phones are offered for Send to mobile", async () => {
	routes = {
		"GET /api/devices": () => [
			{ id: "p", name: "Pixel", platform: "Android", canReceiveLinks: true },
			{ id: "b", name: "Chrome", platform: "Browser", canReceiveLinks: false },
			{ id: "w", name: "Web", platform: "Web", canReceiveLinks: false },
		],
	};
	await signedIn();

	expect((await api.fetchMobileDevices()).map((d) => d.id)).toEqual(["p"]);
});

test("sending a link posts it to the phone and explains failures", async () => {
	routes = {
		"POST /api/devices/phone%2F1/links": () => json(202),
	};
	await signedIn();
	await api.sendLinkToMobile("phone/1", "https://example.com", "Example");
	expect(calls[0].url).toBe(`${API}/api/devices/phone%2F1/links`);
	expect(calls[0].body).toEqual({ url: "https://example.com", title: "Example" });

	routes["POST /api/devices/phone/links"] = () =>
		json(409, { detail: "Open Chime on this phone and enable receiving links first." });
	const conflict = await api.sendLinkToMobile("phone", "https://example.com", "").catch((e) => e);
	expect(conflict.status).toBe(409);
	expect(conflict.message).toBe("Open Chime on this phone and enable receiving links first.");

	routes["POST /api/devices/phone/links"] = () =>
		json(400, { errors: { Url: ["Send an absolute HTTP or HTTPS URL."], Title: ["Too long."] } });
	const invalid = await api.sendLinkToMobile("phone", "x", "").catch((e) => e);
	expect(invalid.message).toBe("Send an absolute HTTP or HTTPS URL. Too long.");
});

test("Web Push is optional: a 404 key means it's off, other errors propagate", async () => {
	await signedIn();
	routes = { "GET /api/web-push/key": () => ({ publicKey: "BPub" }) };
	expect(await api.fetchWebPushKey()).toBe("BPub");

	routes = { "GET /api/web-push/key": () => json(404) };
	expect(await api.fetchWebPushKey()).toBeNull();

	routes = { "GET /api/web-push/key": () => json(500) };
	expect((await api.fetchWebPushKey().catch((e) => e)).status).toBe(500);
});

test("the badge shows the unread count, capped at 99, and clears at zero", async () => {
	await api.setBadge(3);
	expect(badge.text).toBe("3");
	await api.setBadge(250);
	expect(badge.text).toBe("99");
	await api.setBadge(0);
	expect(badge.text).toBe("");
});
