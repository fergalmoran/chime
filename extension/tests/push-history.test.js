import { beforeEach, expect, mock, test } from "bun:test";

const store = new Map();
mock.module("#imports", () => ({
	storage: {
		defineItem: (key, { fallback }) => ({
			getValue: async () => (store.has(key) ? store.get(key) : fallback),
			setValue: async (value) => { store.set(key, value); },
			watch: () => () => {},
		}),
	},
}));
mock.module("wxt/browser", () => ({ browser: { action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} } } }));

const api = await import("../lib/api.ts?push-history");

beforeEach(() => store.clear());

const page = (n) => ({ url: `https://example.com/${n}`, title: `Page ${n}`, deviceId: "d1", deviceName: "Pixel" });

test("recordPush adds newest first and caps the history", async () => {
	for (let i = 0; i < api.PUSH_HISTORY_LIMIT + 5; i++) await api.recordPush(page(i));
	const history = await api.pushHistoryItem.getValue();
	expect(history).toHaveLength(api.PUSH_HISTORY_LIMIT);
	expect(history[0].title).toBe(`Page ${api.PUSH_HISTORY_LIMIT + 4}`);
	expect(typeof history[0].id).toBe("string");
	expect(Date.parse(history[0].sentAt)).not.toBeNaN();
});

test("forgetPush removes one entry", async () => {
	const a = await api.recordPush(page("a"));
	await api.recordPush(page("b"));
	await api.forgetPush(a.id);
	expect((await api.pushHistoryItem.getValue()).map((p) => p.title)).toEqual(["Page b"]);
});

test("logout clears the push history", async () => {
	await api.recordPush(page("a"));
	await api.logout();
	expect(await api.pushHistoryItem.getValue()).toEqual([]);
});

test("isMessage treats chat and SMS as messages", () => {
	expect(api.isMessage({ category: "Message" })).toBe(true);
	expect(api.isMessage({ category: "Sms" })).toBe(true);
	expect(api.isMessage({ category: "Email" })).toBe(false);
});
