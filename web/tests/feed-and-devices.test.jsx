import { expect, test } from "bun:test";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route as DevicesRoute } from "../src/routes/_app/devices.tsx";
import { Route as FeedRoute } from "../src/routes/_app/index.tsx";
import { json, mockApi, renderPage, signIn } from "./render.jsx";

const FeedPage = FeedRoute.options.component;
const DevicesPage = DevicesRoute.options.component;

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

const page = (items) => ({ items, nextBefore: null });

function deferred() {
	let resolve;
	const promise = new Promise((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

// --- Notifications feed -----------------------------------------------------------------------------------

test("the feed shows loading, then each notification with its app, title, body and time", async () => {
	signIn();
	const gate = deferred();
	mockApi({ "GET /api/notifications": () => gate.promise });
	await renderPage(FeedPage);
	expect(screen.getByText("Loading…")).toBeTruthy();

	gate.resolve(page([item("a"), item("b", { appName: null, appId: "com.example.app", body: null })]));

	const cards = await screen.findAllByRole("listitem");
	expect(cards).toHaveLength(2);
	expect(within(cards[0]).getByText("WhatsApp")).toBeTruthy();
	expect(within(cards[0]).getByText("Title a")).toBeTruthy();
	expect(within(cards[0]).getByText("Body a")).toBeTruthy();
	expect(within(cards[0]).getByText(new Date("2026-11-01T12:00:00Z").toLocaleString())).toBeTruthy();
	expect(cards[0].querySelector("time").getAttribute("dateTime")).toBe("2026-11-01T12:00:00Z");
	// No app name: fall back to the package name. No body (message text off): don't render an empty paragraph.
	expect(within(cards[1]).getByText("com.example.app")).toBeTruthy();
	expect(within(cards[1]).queryByText(/^Body/)).toBeNull();
});

test("an empty feed explains how to get started", async () => {
	signIn();
	mockApi({ "GET /api/notifications": () => page([]) });
	await renderPage(FeedPage);
	expect(await screen.findByText(/Nothing here yet/)).toBeTruthy();
});

test("a failed load says so instead of spinning forever", async () => {
	signIn();
	mockApi({ "GET /api/notifications": () => json(500, { title: "boom" }) });
	await renderPage(FeedPage);
	expect(await screen.findByText("Couldn't load notifications.")).toBeTruthy();
});

test("titles and bodies are shown as text, never as HTML", async () => {
	signIn();
	mockApi({
		"GET /api/notifications": () => page([item("x", { title: "<img src=x onerror=alert(1)>", body: "<b>bold</b>" })]),
	});
	const { container } = await renderPage(FeedPage);
	expect(await screen.findByText("<img src=x onerror=alert(1)>")).toBeTruthy();
	expect(container.querySelector("img")).toBeNull();
	expect(container.querySelector("b")).toBeNull();
});

test("dismissing a notification tells the API and removes it from the feed", async () => {
	const user = userEvent.setup();
	signIn();
	const calls = mockApi({
		"GET /api/notifications": () => page([item("a"), item("b")]),
		"POST /api/notifications/a/dismiss": () => json(204),
	});
	await renderPage(FeedPage);
	const [first] = await screen.findAllByRole("listitem");

	await user.click(within(first).getByRole("button", { name: "Dismiss" }));

	expect(calls.some((c) => c.method === "POST" && c.path === "/api/notifications/a/dismiss")).toBe(true);
	// Without relying on the live hub: the dashboard may have no live connection at all.
	await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
	expect(screen.queryByText("Title a")).toBeNull();
});

test("only the notification being dismissed is disabled while the request is in flight", async () => {
	const user = userEvent.setup();
	signIn();
	const gate = deferred();
	mockApi({
		"GET /api/notifications": () => page([item("a"), item("b")]),
		"POST /api/notifications/a/dismiss": () => gate.promise,
	});
	await renderPage(FeedPage);
	const [first, second] = await screen.findAllByRole("listitem");

	await user.click(within(first).getByRole("button", { name: "Dismiss" }));

	await waitFor(() => expect(within(first).getByRole("button", { name: "Dismiss" }).disabled).toBe(true));
	expect(within(second).getByRole("button", { name: "Dismiss" }).disabled).toBe(false);
	gate.resolve(json(204));
});

test("a notification that's already gone (404) is removed rather than left stuck", async () => {
	const user = userEvent.setup();
	signIn();
	mockApi({
		"GET /api/notifications": (_, n) => (n === 1 ? page([item("a"), item("b")]) : page([item("b")])),
		"POST /api/notifications/a/dismiss": () => json(404),
	});
	await renderPage(FeedPage);
	const [first] = await screen.findAllByRole("listitem");

	await user.click(within(first).getByRole("button", { name: "Dismiss" }));

	await waitFor(() => expect(screen.queryByText("Title a")).toBeNull());
});

// --- Devices ---------------------------------------------------------------------------------------------

const device = (id, extra = {}) => ({
	id,
	name: `Device ${id}`,
	platform: "Android",
	createdAt: "2026-10-01T00:00:00Z",
	lastSeenAt: "2026-11-01T12:00:00Z",
	...extra,
});

test("devices are listed with their platform and when they were last seen", async () => {
	signIn();
	mockApi({
		"GET /api/devices": () => [device("p"), device("b", { name: "Chrome extension", platform: "Browser", lastSeenAt: null })],
	});
	await renderPage(DevicesPage, { path: "/devices" });

	const [phone, browser] = await screen.findAllByRole("listitem");
	expect(within(phone).getByText("Device p")).toBeTruthy();
	expect(within(phone).getByText(`Android · last seen ${new Date("2026-11-01T12:00:00Z").toLocaleString()}`)).toBeTruthy();
	expect(within(browser).getByText("Browser · last seen never")).toBeTruthy();
});

test("no devices yet explains how to add one; failures say so", async () => {
	signIn();
	mockApi({ "GET /api/devices": () => [] });
	await renderPage(DevicesPage, { path: "/devices" });
	expect(await screen.findByText(/No devices yet/)).toBeTruthy();
});

test("a failed device load says so", async () => {
	signIn();
	mockApi({ "GET /api/devices": () => json(500) });
	await renderPage(DevicesPage, { path: "/devices" });
	expect(await screen.findByText("Couldn't load devices.")).toBeTruthy();
});

test("removing a device asks first, then deletes it and refreshes the list", async () => {
	const user = userEvent.setup();
	signIn();
	const prompts = [];
	window.confirm = (message) => {
		prompts.push(message);
		return true;
	};
	const calls = mockApi({
		"GET /api/devices": (_, n) => (n === 1 ? [device("p"), device("q")] : [device("q")]),
		"DELETE /api/devices/p": () => json(204),
	});
	await renderPage(DevicesPage, { path: "/devices" });

	await user.click(await screen.findByRole("button", { name: "Remove Device p" }));

	expect(prompts).toEqual(["Remove Device p?"]);
	expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/devices/p")).toBe(true);
	await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
	expect(screen.queryByText("Device p")).toBeNull();
});

test("cancelling the confirmation keeps the device", async () => {
	const user = userEvent.setup();
	signIn();
	window.confirm = () => false;
	const calls = mockApi({ "GET /api/devices": () => [device("p")] });
	await renderPage(DevicesPage, { path: "/devices" });

	await user.click(await screen.findByRole("button", { name: "Remove Device p" }));

	expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
	expect(screen.getByText("Device p")).toBeTruthy();
});
