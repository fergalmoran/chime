import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	ApiError,
	api,
	authStore,
	describeError,
	getAccessToken,
} from "../src/lib/api.ts";
import { installBrowser, json, uninstallBrowser } from "./test-browser.js";

const TOKEN_KEY = "chime.tokens";
const originalFetch = globalThis.fetch;
let browser;

function storeTokens({ access = "access-1", refresh = "refresh-1", expiresInMs = 3_600_000 } = {}) {
	browser.localStorage.setItem(
		TOKEN_KEY,
		JSON.stringify({ accessToken: access, refreshToken: refresh, expiresAt: Date.now() + expiresInMs }),
	);
}

const tokens = (access, refresh = `${access}-refresh`) => ({
	accessToken: access,
	refreshToken: refresh,
	expiresIn: 3600,
});

function setup(routes) {
	browser = installBrowser({ routes });
	return browser;
}

beforeEach(() => setup({}));
afterEach(() => {
	globalThis.fetch = originalFetch;
	uninstallBrowser();
});

test("signing in stores the tokens and notifies subscribers", async () => {
	setup({ "POST /api/auth/google": () => tokens("from-google") });
	let notified = 0;
	const unsubscribe = authStore.subscribe(() => notified++);

	await api.loginWithGoogle("google-id-token");
	unsubscribe();

	expect(browser.calls[0].body).toEqual({ idToken: "google-id-token" });
	expect(authStore.isAuthenticated()).toBe(true);
	expect(await getAccessToken()).toBe("from-google");
	expect(notified).toBe(1);
});

test("a failed sign-in throws with the problem details and stores nothing", async () => {
	setup({ "POST /api/auth/google": () => json(401, { title: "Invalid Google credential." }) });

	const error = await api.loginWithGoogle("bad").catch((e) => e);

	expect(error).toBeInstanceOf(ApiError);
	expect(error.status).toBe(401);
	expect(describeError(error)).toBe("Please sign in again.");
	expect(authStore.isAuthenticated()).toBe(false);
});

test("requests carry the bearer token and JSON bodies", async () => {
	setup({
		"PUT /api/settings": (call) => call.body,
	});
	storeTokens();
	const settings = {
		syncEnabled: true,
		includeMessageBody: false,
		retentionDays: 3,
		mutedApps: [],
		enabledCategories: ["Sms"],
	};

	expect(await api.updateSettings(settings)).toEqual(settings);

	const [call] = browser.calls;
	expect(call.headers.get("Authorization")).toBe("Bearer access-1");
	expect(call.headers.get("Content-Type")).toBe("application/json");
});

test("the notifications cursor is URL-encoded", async () => {
	setup({ "GET /api/notifications": () => ({ items: [], nextBefore: null }) });
	storeTokens();

	await api.notifications();
	await api.notifications("2026-11-01T12:00:00.0000000+00:00");

	expect(browser.calls[0].search).toBe("");
	expect(new URLSearchParams(browser.calls[1].search).get("before")).toBe(
		"2026-11-01T12:00:00.0000000+00:00",
	);
	expect(browser.calls[1].search).toContain("%2B00%3A00");
});

test("204 responses resolve to undefined", async () => {
	setup({ "DELETE /api/devices/d1": () => json(204) });
	storeTokens();

	expect(await api.deleteDevice("d1")).toBeUndefined();
});

test("a token about to expire is refreshed before the request", async () => {
	setup({
		"POST /api/auth/refresh": (call) => {
			expect(call.body).toEqual({ refreshToken: "refresh-1" });
			return tokens("access-2");
		},
		"GET /api/me": (call) => ({ id: "u", email: call.headers.get("Authorization") }),
	});
	storeTokens({ expiresInMs: 10_000 });

	const me = await api.me();

	expect(me.email).toBe("Bearer access-2");
	expect(browser.calls.map((c) => c.path)).toEqual(["/api/auth/refresh", "/api/me"]);
});

test("a 401 is retried once with refreshed tokens", async () => {
	setup({
		"POST /api/auth/refresh": () => tokens("access-2"),
		"GET /api/devices": (call, n) => (n === 1 ? json(401) : [{ id: call.headers.get("Authorization") }]),
	});
	storeTokens();

	const devices = await api.devices();

	expect(devices).toEqual([{ id: "Bearer access-2" }]);
	expect(browser.calls.map((c) => c.path)).toEqual(["/api/devices", "/api/auth/refresh", "/api/devices"]);
});

test("a 401 that survives a refresh is not retried forever", async () => {
	setup({
		"POST /api/auth/refresh": () => tokens("access-2"),
		"GET /api/devices": () => json(401),
	});
	storeTokens();

	const error = await api.devices().catch((e) => e);

	expect(error.status).toBe(401);
	expect(browser.calls.filter((c) => c.path === "/api/devices")).toHaveLength(2);
});

test("a rejected refresh signs the user out", async () => {
	setup({
		"POST /api/auth/refresh": () => json(401),
		"GET /api/me": () => json(401),
	});
	storeTokens();
	let notified = 0;
	const unsubscribe = authStore.subscribe(() => notified++);

	const error = await api.me().catch((e) => e);
	unsubscribe();

	expect(error.status).toBe(401);
	expect(authStore.isAuthenticated()).toBe(false);
	expect(browser.localStorage.getItem(TOKEN_KEY)).toBeNull();
	expect(notified).toBe(1);
});

test("concurrent requests share one refresh", async () => {
	let release;
	const gate = new Promise((r) => {
		release = r;
	});
	setup({
		"POST /api/auth/refresh": async () => {
			await gate;
			return tokens("access-2");
		},
		"GET /api/me": () => ({ id: "u" }),
		"GET /api/devices": () => [],
		"GET /api/settings": () => ({}),
	});
	storeTokens({ expiresInMs: 1_000 });

	const all = Promise.all([api.me(), api.devices(), api.settings()]);
	release();
	await all;

	expect(browser.calls.filter((c) => c.path === "/api/auth/refresh")).toHaveLength(1);
	expect(browser.calls.filter((c) => c.path !== "/api/auth/refresh").every((c) =>
		c.headers.get("Authorization") === "Bearer access-2")).toBe(true);
});

test("without tokens, requests go out anonymously and nothing is refreshed", async () => {
	setup({ "GET /api/me": () => json(401) });

	expect(await getAccessToken()).toBeNull();
	await api.me().catch(() => {});

	expect(browser.calls.map((c) => c.path)).toEqual(["/api/me"]);
	expect(browser.calls[0].headers.has("Authorization")).toBe(false);
});

test("logging out clears the stored tokens", () => {
	storeTokens();
	authStore.logout();
	expect(authStore.isAuthenticated()).toBe(false);
});

test("describeError flattens validation problems and falls back sensibly", () => {
	expect(
		describeError(new ApiError(400, { errors: { RetentionDays: ["Must be 1-365."], Name: ["Required."] } })),
	).toBe("Must be 1-365. Required.");
	expect(describeError(new ApiError(409, { title: "Open Chime on this phone first." }))).toBe(
		"Open Chime on this phone first.",
	);
	expect(describeError(new ApiError(500))).toBe("API request failed with status 500");
	expect(describeError(new Error("offline"))).toBe("offline");
	expect(describeError("weird")).toBe("Something went wrong.");
});
