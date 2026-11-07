import { api, GOOGLE_CLIENT_ID } from "#/lib/api";

/**
 * Google sign-in via the OAuth implicit flow for an ID token: a full-page
 * redirect to Google and back to /auth/callback. Same flow and client as the
 * browser extension (extension/lib/google.ts), so no Google-rendered button.
 *
 * `${origin}/auth/callback` must be an authorised redirect URI on the client.
 */

const PENDING_KEY = "chime.google-sign-in";

interface PendingSignIn {
	state: string;
	nonce: string;
	returnTo: string;
}

export const googleRedirectUri = () =>
	`${window.location.origin}/auth/callback`;

export function startGoogleSignIn(returnTo = "/") {
	if (!GOOGLE_CLIENT_ID) throw new Error("Google sign-in is not configured.");

	const pending: PendingSignIn = {
		state: crypto.randomUUID(),
		nonce: crypto.randomUUID(),
		returnTo: safeReturnTo(returnTo),
	};
	sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));

	const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
	url.search = new URLSearchParams({
		client_id: GOOGLE_CLIENT_ID,
		response_type: "id_token",
		redirect_uri: googleRedirectUri(),
		scope: "openid email profile",
		state: pending.state,
		nonce: pending.nonce,
		prompt: "select_account",
	}).toString();
	window.location.assign(url.toString());
}

/** Finishes sign-in from the callback URL's fragment; returns where to go next. */
export async function completeGoogleSignIn(hash: string): Promise<string> {
	const raw = sessionStorage.getItem(PENDING_KEY);
	sessionStorage.removeItem(PENDING_KEY);
	const pending = raw ? (JSON.parse(raw) as PendingSignIn) : null;

	const params = new URLSearchParams(hash.replace(/^#/, ""));
	const error = params.get("error");
	if (error) {
		throw new Error(
			error === "access_denied" ? "Sign-in was cancelled." : error,
		);
	}
	const idToken = params.get("id_token");
	if (!idToken) throw new Error("Google did not return a credential.");
	if (
		!pending ||
		params.get("state") !== pending.state ||
		readNonce(idToken) !== pending.nonce
	) {
		throw new Error("Google sign-in response could not be verified.");
	}

	await api.loginWithGoogle(idToken);
	return pending.returnTo;
}

function safeReturnTo(path: string) {
	return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

function readNonce(jwt: string): string | undefined {
	try {
		const payload = (jwt.split(".")[1] ?? "")
			.replace(/-/g, "+")
			.replace(/_/g, "/");
		return (JSON.parse(atob(payload)) as { nonce?: string }).nonce;
	} catch {
		return undefined;
	}
}
