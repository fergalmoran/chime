import { afterEach, beforeEach, expect, test } from "bun:test";
import { installBrowser, uninstallBrowser } from "./test-browser.js";

// GOOGLE_CLIENT_ID is read from import.meta.env when lib/api loads.
process.env.VITE_GOOGLE_CLIENT_ID ??= "test-client.apps.googleusercontent.com";
const { completeGoogleSignIn, startGoogleSignIn } = await import("../src/lib/google-auth.ts");
const { authStore } = await import("../src/lib/api.ts");

const originalFetch = globalThis.fetch;
let browser;

beforeEach(() => {
	browser = installBrowser({
		routes: {
			"POST /api/auth/google": () => ({ accessToken: "a", refreshToken: "r", expiresIn: 3600 }),
		},
	});
});
afterEach(() => {
	globalThis.fetch = originalFetch;
	uninstallBrowser();
});

const base64Url = (value) =>
	btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fakeIdToken = (payload) => `${base64Url({ alg: "RS256" })}.${base64Url(payload)}.signature`;

/** Starts sign-in and returns what was sent to Google. */
function start(returnTo) {
	startGoogleSignIn(returnTo);
	const url = new URL(browser.assigned.at(-1));
	return { url, params: url.searchParams };
}

function callbackHash({ state, nonce, idToken = fakeIdToken({ nonce, sub: "1" }) }) {
	return `#${new URLSearchParams({ id_token: idToken, state }).toString()}`;
}

test("starting sign-in redirects to Google with a fresh state and nonce", () => {
	const { url, params } = start("/settings");
	const first = { state: params.get("state"), nonce: params.get("nonce") };
	const second = start("/").params;

	expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
	expect(params.get("client_id")).toBe(process.env.VITE_GOOGLE_CLIENT_ID);
	expect(params.get("response_type")).toBe("id_token");
	expect(params.get("redirect_uri")).toBe("https://chime.test/auth/callback");
	expect(params.get("scope")).toBe("openid email profile");
	expect(first.state).toBeTruthy();
	expect(first.nonce).toBeTruthy();
	expect(second.get("state")).not.toBe(first.state);
	expect(second.get("nonce")).not.toBe(first.nonce);
});

test("a matching response signs in and returns to the page that started it", async () => {
	const { params } = start("/settings");

	const next = await completeGoogleSignIn(
		callbackHash({ state: params.get("state"), nonce: params.get("nonce") }),
	);

	expect(next).toBe("/settings");
	expect(authStore.isAuthenticated()).toBe(true);
	expect(browser.calls[0].body.idToken).toContain(".");
});

test("a response whose state doesn't match is rejected without calling the API", async () => {
	const { params } = start("/");

	const error = await completeGoogleSignIn(
		callbackHash({ state: "forged", nonce: params.get("nonce") }),
	).catch((e) => e);

	expect(error.message).toBe("Google sign-in response could not be verified.");
	expect(browser.calls).toHaveLength(0);
});

test("a token minted for a different nonce is rejected", async () => {
	const { params } = start("/");

	const error = await completeGoogleSignIn(
		callbackHash({ state: params.get("state"), nonce: "someone-elses-nonce" }),
	).catch((e) => e);

	expect(error.message).toBe("Google sign-in response could not be verified.");
	expect(browser.calls).toHaveLength(0);
});

test("a response can't be replayed: the pending sign-in is used up", async () => {
	const { params } = start("/");
	const hash = callbackHash({ state: params.get("state"), nonce: params.get("nonce") });
	await completeGoogleSignIn(hash);

	const replay = await completeGoogleSignIn(hash).catch((e) => e);

	expect(replay.message).toBe("Google sign-in response could not be verified.");
	expect(browser.calls).toHaveLength(1);
});

test("a callback with no sign-in in progress is rejected", async () => {
	const error = await completeGoogleSignIn(callbackHash({ state: "s", nonce: "n" })).catch((e) => e);
	expect(error.message).toBe("Google sign-in response could not be verified.");
});

test("a garbled ID token is rejected", async () => {
	const { params } = start("/");

	const error = await completeGoogleSignIn(
		callbackHash({ state: params.get("state"), nonce: params.get("nonce"), idToken: "not-a-jwt" }),
	).catch((e) => e);

	expect(error.message).toBe("Google sign-in response could not be verified.");
});

test("Google errors are reported, with cancellation in plain words", async () => {
	start("/");
	expect((await completeGoogleSignIn("#error=access_denied").catch((e) => e)).message).toBe(
		"Sign-in was cancelled.",
	);
	start("/");
	expect((await completeGoogleSignIn("#error=server_error").catch((e) => e)).message).toBe("server_error");
	start("/");
	expect((await completeGoogleSignIn("#state=x").catch((e) => e)).message).toBe(
		"Google did not return a credential.",
	);
});

test.each([
	["https://evil.example/phish", "/"],
	["//evil.example/phish", "/"],
	["javascript:alert(1)", "/"],
	["/devices?x=1", "/devices?x=1"],
])("returnTo %p is only followed when it's a same-site path", async (returnTo, expected) => {
	const { params } = start(returnTo);

	const next = await completeGoogleSignIn(
		callbackHash({ state: params.get("state"), nonce: params.get("nonce") }),
	);

	expect(next).toBe(expected);
});
