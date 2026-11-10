import { expect, mock, test } from "bun:test";

let alarmListener;
let realtimeHandlers;
const alarms = new Map();
let checkpoint = null;
let items = [];
const alerts = [];
let currentTab;
let fetchImpl = async () => items;
const api = {
	fetchNotifications: () => fetchImpl(),
	GOOGLE_CLIENT_ID: undefined,
	lastSeenItem: {
		getValue: async () => checkpoint,
		setValue: async (value) => { checkpoint = value; },
	},
	sessionItem: { getValue: async () => ({}), watch: () => {} },
	setBadge: async () => {},
};

mock.module("../lib/api", () => api);
mock.module("../lib/realtime", () => ({
	createRealtime: (handlers) => {
		realtimeHandlers = handlers;
		return { start: async () => {}, stop: async () => {} };
	},
}));
mock.module("../lib/google", () => ({
	googleRedirectUrl: () => "",
	signInWithGoogle: async () => {},
}));
mock.module("wxt/browser", () => ({
	browser: {
		alarms: {
			create: (name, info) => { alarms.set(name, { name, ...info }); },
			get: async (name) => alarms.get(name),
			onAlarm: { addListener: (listener) => { alarmListener = listener; } },
		},
		runtime: {
			onMessage: { addListener: () => {} },
			getURL: (path) => path,
		},
		notifications: { create: async (id, options) => { alerts.push({ id, options }); } },
		tabs: { query: async () => currentTab ? [currentTab] : [] },
	},
}));
globalThis.defineBackground = (definition) => definition.main;

// Wait for the fire-and-forget alarm handler to finish its storage/API work.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("first arrival after an empty poll alerts, more than three arrivals aren't dropped, and repeats don't alert", async () => {
	const { default: start } = await import("../entrypoints/background.ts");
	start();
	await settle();
	expect(checkpoint).not.toBeNull();

	const receivedAt = new Date(Date.parse(checkpoint) + 1000).toISOString();
	items = Array.from({ length: 5 }, (_, i) => ({
		id: `notification-${i}`,
		title: `Android ${i}`,
		body: "Hello desktop",
		receivedAt,
	}));
	alarmListener({ name: "chime-poll" });
	await settle();
	expect(alerts).toHaveLength(5);
	expect(alerts[0].options.message).toBe("Hello desktop");
	alarmListener({ name: "chime-poll" });
	await settle();
	expect(alerts).toHaveLength(5);
});

test("a change signalled mid-poll triggers one more poll instead of being dropped", async () => {
	let release;
	let fetches = 0;
	fetchImpl = async () => {
		fetches++;
		if (fetches === 1) await new Promise((resolve) => { release = resolve; });
		return items;
	};
	try {
		const first = realtimeHandlers.onChange();
		await settle();
		const second = realtimeHandlers.onChange();
		const third = realtimeHandlers.onChange();
		release();
		await Promise.all([first, second, third]);
		expect(fetches).toBe(2);
	} finally {
		fetchImpl = async () => items;
	}
});

test("the fallback poll slows down while a live channel is up", async () => {
	await settle();
	expect(alarms.get("chime-poll")?.periodInMinutes).toBe(1);
	realtimeHandlers.onStatus(true);
	await settle();
	expect(alarms.get("chime-poll")?.periodInMinutes).toBe(15);
	realtimeHandlers.onStatus(false);
	await settle();
	expect(alarms.get("chime-poll")?.periodInMinutes).toBe(1);
});

test("Send to mobile reads the active page's URL and title", async () => {
	const { currentPage } = await import("../lib/current-page.ts");
	currentTab = { url: "https://example.com/article?q=1#section", title: "Read this" };
	expect(await currentPage()).toEqual({ url: currentTab.url, title: currentTab.title });
});

test("Send to mobile rejects inaccessible tabs and non-web URLs", async () => {
	const { currentPage } = await import("../lib/current-page.ts");
	for (const url of [undefined, "chrome://extensions", "about:blank", "file:///tmp/test", "https://user:pass@example.com"]) {
		currentTab = url ? { url } : undefined;
		await expect(currentPage()).rejects.toThrow();
	}
});

test("Send to mobile enforces the URL limit and trims long page titles", async () => {
	const { currentPage } = await import("../lib/current-page.ts");
	const prefix = "https://example.com/";
	currentTab = { url: prefix + "a".repeat(2048 - prefix.length), title: "t".repeat(201) };
	expect((await currentPage()).title).toHaveLength(200);
	currentTab.url += "a";
	await expect(currentPage()).rejects.toThrow("too long");
});
