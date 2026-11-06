import { afterEach, expect, test } from "bun:test";
import { showDesktopNotification } from "../src/lib/desktop-notifications.ts";

const originalWindow = globalThis.window;
const originalNotification = globalThis.Notification;
const originalStorage = globalThis.localStorage;
const shown = [];
let enabled = true;

function installBrowser(permission = "granted") {
	shown.length = 0;
	enabled = true;
	globalThis.window = { isSecureContext: true, Notification: true };
	globalThis.localStorage = { getItem: () => (enabled ? "true" : null) };
	globalThis.Notification = class {
		static permission = permission;
		constructor(title, options) {
			shown.push({ title, options });
		}
	};
}

afterEach(() => {
	globalThis.window = originalWindow;
	globalThis.Notification = originalNotification;
	globalThis.localStorage = originalStorage;
});

const notification = {
	id: "test-id",
	title: "Test from Android",
	body: "Hello desktop",
	appName: "Chime",
	appId: "com.podnoms.chime",
};

test("an opted-in arrival creates an OS notification with its content and stable tag", () => {
	installBrowser();
	showDesktopNotification(notification);
	expect(shown).toEqual([
		{
			title: "Test from Android",
			options: { body: "Hello desktop", tag: "chime:test-id" },
		},
	]);
});

test("no alert without explicit opt-in or notification permission", () => {
	installBrowser();
	enabled = false;
	showDesktopNotification(notification);
	installBrowser("denied");
	showDesktopNotification(notification);
	installBrowser("default");
	showDesktopNotification(notification);
	expect(shown).toHaveLength(0);
});

test("a redacted notification falls back to the app name without inventing body text", () => {
	installBrowser();
	showDesktopNotification({ ...notification, title: null, body: null });
	expect(shown[0]).toEqual({
		title: "Chime",
		options: { body: "", tag: "chime:test-id" },
	});
});

test("an unavailable notification API does not break the live feed", () => {
	installBrowser();
	delete globalThis.window.Notification;
	showDesktopNotification(notification);
	expect(shown).toHaveLength(0);
});
