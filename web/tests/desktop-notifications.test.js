import { afterEach, expect, test } from "bun:test";
import {
	DESKTOP_NOTIFICATIONS_KEY,
	desktopNotificationsSupported,
	showDesktopNotification,
} from "../src/lib/desktop-notifications.ts";
import { installNotificationApi, removeNotificationApi } from "./notification-api.js";

afterEach(removeNotificationApi);

const notification = {
	id: "test-id",
	title: "Test from Android",
	body: "Hello desktop",
	appName: "Chime",
	appId: "com.podnoms.chime",
};

function optIn() {
	localStorage.setItem(DESKTOP_NOTIFICATIONS_KEY, "true");
}

test("an opted-in arrival creates an OS notification with its content and stable tag", () => {
	const api = installNotificationApi("granted");
	optIn();
	showDesktopNotification(notification);
	expect(api.shown.map(({ title, options }) => ({ title, options }))).toEqual([
		{
			title: "Test from Android",
			options: { body: "Hello desktop", tag: "chime:test-id" },
		},
	]);
});

test("no alert without explicit opt-in or notification permission", () => {
	let api = installNotificationApi("granted");
	showDesktopNotification(notification);
	expect(api.shown).toHaveLength(0);

	optIn();
	for (const permission of ["denied", "default"]) {
		api = installNotificationApi(permission);
		showDesktopNotification(notification);
		expect(api.shown).toHaveLength(0);
	}
});

test("a redacted notification falls back to the app name, then the package, without inventing body text", () => {
	const api = installNotificationApi("granted");
	optIn();
	showDesktopNotification({ ...notification, title: null, body: null });
	showDesktopNotification({ ...notification, title: "", appName: null, body: null });
	expect(api.shown.map((s) => [s.title, s.options.body])).toEqual([
		["Chime", ""],
		["com.podnoms.chime", ""],
	]);
});

test("an unavailable notification API does not break the live feed", () => {
	removeNotificationApi();
	optIn();
	expect(desktopNotificationsSupported()).toBe(false);
	expect(() => showDesktopNotification(notification)).not.toThrow();
});

test("clicking an alert brings the dashboard forward and closes the alert", () => {
	const api = installNotificationApi("granted");
	optIn();
	let focused = 0;
	const assigned = [];
	window.focus = () => focused++;
	window.location.assign = (url) => assigned.push(url);
	showDesktopNotification(notification);

	api.shown[0].onclick();

	expect(focused).toBe(1);
	expect(assigned).toEqual(["/"]);
	expect(api.shown[0].closed).toBe(true);
});

test("an OS that refuses to show the alert is logged, not thrown", () => {
	installNotificationApi("granted", { throwOnCreate: true });
	optIn();
	const warn = console.warn;
	const warnings = [];
	console.warn = (...args) => warnings.push(args);
	try {
		expect(() => showDesktopNotification(notification)).not.toThrow();
		expect(warnings).toHaveLength(1);
	} finally {
		console.warn = warn;
	}
});
