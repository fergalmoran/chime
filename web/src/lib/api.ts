export const API_URL =
	(import.meta.env.VITE_API_URL as string | undefined) ??
	"https://chime.dev.fergl.ie:5002";

export type DevicePlatform = "Android" | "Browser" | "Web";
export type NotificationCategory =
	| "Other"
	| "Message"
	| "Sms"
	| "Email"
	| "Call";
export const ALL_CATEGORIES: NotificationCategory[] = [
	"Message",
	"Sms",
	"Email",
	"Call",
	"Other",
];

export interface Me {
	id: string;
	email: string;
	createdAt: string;
}

export interface Device {
	id: string;
	name: string;
	platform: DevicePlatform;
	createdAt: string;
	lastSeenAt: string | null;
}

export interface SyncedNotification {
	id: string;
	sourceDeviceId: string | null;
	appId: string;
	appName: string | null;
	category: NotificationCategory;
	title: string | null;
	body: string | null;
	postedAt: string;
	receivedAt: string;
	dismissedAt: string | null;
}

export interface NotificationPage {
	items: SyncedNotification[];
	nextBefore: string | null;
}

export interface Settings {
	syncEnabled: boolean;
	includeMessageBody: boolean;
	retentionDays: number;
	mutedApps: string[];
	enabledCategories: NotificationCategory[];
}

interface Tokens {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
}

const TOKEN_KEY = "chime.tokens";
const listeners = new Set<() => void>();

function readTokens(): Tokens | null {
	if (typeof window === "undefined") return null;
	const raw = window.localStorage.getItem(TOKEN_KEY);
	return raw ? (JSON.parse(raw) as Tokens) : null;
}

function writeTokens(tokens: Tokens | null) {
	if (tokens) window.localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
	else window.localStorage.removeItem(TOKEN_KEY);
	for (const l of listeners) l();
}

export const authStore = {
	subscribe(listener: () => void) {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	isAuthenticated: () => readTokens() !== null,
	logout: () => writeTokens(null),
};

export class ApiError extends Error {
	constructor(
		public status: number,
		public details?: unknown,
	) {
		super(`API request failed with status ${status}`);
	}
}

interface TokenResponse {
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
}

function storeTokenResponse(res: TokenResponse) {
	writeTokens({
		accessToken: res.accessToken,
		refreshToken: res.refreshToken,
		expiresAt: Date.now() + res.expiresIn * 1000,
	});
}

let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
	const tokens = readTokens();
	if (!tokens) return false;
	refreshing ??= fetch(`${API_URL}/api/auth/refresh`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ refreshToken: tokens.refreshToken }),
	})
		.then(async (res) => {
			if (!res.ok) {
				writeTokens(null);
				return false;
			}
			storeTokenResponse(await res.json());
			return true;
		})
		.finally(() => {
			refreshing = null;
		});
	return refreshing;
}

/** Returns a valid access token, refreshing it first if it is about to expire. */
export async function getAccessToken(): Promise<string | null> {
	const tokens = readTokens();
	if (!tokens) return null;
	if (tokens.expiresAt - Date.now() < 30_000 && !(await refreshTokens()))
		return null;
	return readTokens()?.accessToken ?? null;
}

async function request<T>(
	path: string,
	init: RequestInit = {},
	retry = true,
): Promise<T> {
	const token = await getAccessToken();
	const headers = new Headers(init.headers);
	if (init.body) headers.set("Content-Type", "application/json");
	if (token) headers.set("Authorization", `Bearer ${token}`);

	const res = await fetch(`${API_URL}${path}`, { ...init, headers });
	if (res.status === 401 && retry && token && (await refreshTokens())) {
		return request<T>(path, init, false);
	}
	if (!res.ok) {
		const details = await res.json().catch(() => undefined);
		throw new ApiError(res.status, details);
	}
	if (res.status === 204 || res.headers.get("content-length") === "0")
		return undefined as T;
	return (await res.json()) as T;
}

/** Google OAuth web client ID — the only sign-in method. */
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as
	| string
	| undefined;

async function signIn(path: string, body: unknown) {
	const res = await fetch(`${API_URL}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!res.ok)
		throw new ApiError(res.status, await res.json().catch(() => undefined));
	storeTokenResponse(await res.json());
}

export const api = {
	loginWithGoogle: (idToken: string) => signIn("/api/auth/google", { idToken }),
	me: () => request<Me>("/api/me"),
	devices: () => request<Device[]>("/api/devices"),
	deleteDevice: (id: string) =>
		request<void>(`/api/devices/${id}`, { method: "DELETE" }),
	notifications: (before?: string) =>
		request<NotificationPage>(
			`/api/notifications${before ? `?before=${encodeURIComponent(before)}` : ""}`,
		),
	dismissNotification: (id: string) =>
		request<void>(`/api/notifications/${id}/dismiss`, { method: "POST" }),
	settings: () => request<Settings>("/api/settings"),
	updateSettings: (settings: Settings) =>
		request<Settings>("/api/settings", {
			method: "PUT",
			body: JSON.stringify(settings),
		}),
};

/** Flattens an ASP.NET validation problem into a readable message. */
export function describeError(error: unknown): string {
	if (error instanceof ApiError) {
		const details = error.details as
			| { errors?: Record<string, string[]>; title?: string }
			| undefined;
		if (details?.errors) return Object.values(details.errors).flat().join(" ");
		if (error.status === 401) return "Please sign in again.";
		return details?.title ?? error.message;
	}
	return error instanceof Error ? error.message : "Something went wrong.";
}
