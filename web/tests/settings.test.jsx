import { expect, test } from "bun:test";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route } from "../src/routes/_app/settings.tsx";
import { currentPath, json, mockApi, renderPage, signIn } from "./render.jsx";

const SettingsPage = Route.options.component;

const defaults = () => ({
	syncEnabled: true,
	includeMessageBody: true,
	retentionDays: 7,
	mutedApps: ["com.noisy", "com.spam"],
	enabledCategories: ["Message", "Sms", "Email", "Call"],
});

function deferred() {
	let resolve;
	const promise = new Promise((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

/** Renders Settings for a signed-in user; `routes` add to or override the default API. */
async function renderSettings(routes = {}, { url = "/settings", settings = defaults() } = {}) {
	signIn();
	const calls = mockApi({
		"GET /api/settings": () => settings,
		"GET /api/me": () => ({ id: "u1", email: "Me@Example.com", createdAt: "2026-01-01T00:00:00Z" }),
		"PUT /api/settings": (call) => call.body,
		...routes,
	});
	const rendered = await renderPage(SettingsPage, { path: "/settings", url });
	await screen.findByRole("button", { name: "Save settings" });
	return { calls, ...rendered };
}

const saved = (calls) => calls.filter((c) => c.method === "PUT" && c.path === "/api/settings").map((c) => c.body);
const control = (role, name) => screen.getByRole(role, { name });
const checked = (el) => el.getAttribute("aria-checked") === "true" || el.getAttribute("data-state") === "checked";

// --- Loading -------------------------------------------------------------------------------------------------

test("shows loading, then a failure message if settings can't be loaded", async () => {
	signIn();
	mockApi({ "GET /api/settings": () => json(500), "GET /api/me": () => json(500) });
	await renderPage(SettingsPage, { path: "/settings" });
	expect(await screen.findByText("Couldn't load settings.")).toBeTruthy();
});

test("the form starts from the saved settings", async () => {
	await renderSettings({}, { settings: { ...defaults(), includeMessageBody: false, retentionDays: 30 } });

	expect(checked(control("switch", "Sync notifications"))).toBe(true);
	expect(checked(control("switch", "Include message contents"))).toBe(false);
	expect(control("spinbutton", "Keep notifications for (days)").value).toBe("30");
	expect(control("textbox", "Muted apps").value).toBe("com.noisy\ncom.spam");
	for (const name of ["Message", "SMS", "Email", "Call"]) expect(checked(control("checkbox", name))).toBe(true);
	expect(checked(control("checkbox", "Other"))).toBe(false);
});

// --- Saving --------------------------------------------------------------------------------------------------

test("changes are only sent when saved, then confirmed", async () => {
	const user = userEvent.setup();
	const { calls } = await renderSettings();

	await user.click(control("switch", "Sync notifications"));
	await user.click(control("switch", "Include message contents"));
	await user.click(control("checkbox", "SMS"));
	await user.click(control("checkbox", "Other"));
	const retention = control("spinbutton", "Keep notifications for (days)");
	await user.clear(retention);
	await user.type(retention, "30");
	expect(saved(calls)).toHaveLength(0);

	await user.click(control("button", "Save settings"));

	await screen.findByText("Saved.");
	expect(saved(calls)).toEqual([
		{
			syncEnabled: false,
			includeMessageBody: false,
			retentionDays: 30,
			mutedApps: ["com.noisy", "com.spam"],
			enabledCategories: ["Message", "Email", "Call", "Other"],
		},
	]);
});

test("muted apps accept one per line or comma-separated, ignoring blanks and spaces", async () => {
	const user = userEvent.setup();
	const { calls } = await renderSettings();
	const muted = control("textbox", "Muted apps");

	await user.clear(muted);
	await user.type(muted, "  com.a ,com.b{Enter}{Enter}   {Enter}com.c,,");
	await user.click(control("button", "Save settings"));

	await screen.findByText("Saved.");
	expect(saved(calls)[0].mutedApps).toEqual(["com.a", "com.b", "com.c"]);
});

test("the button shows progress and can't double-submit", async () => {
	const user = userEvent.setup();
	const gate = deferred();
	const { calls } = await renderSettings({ "PUT /api/settings": () => gate.promise });

	await user.click(control("button", "Save settings"));

	const button = await screen.findByRole("button", { name: "Saving…" });
	expect(button.disabled).toBe(true);
	await user.click(button);
	expect(saved(calls)).toHaveLength(1);
	gate.resolve(defaults());
	await screen.findByText("Saved.");
});

test("validation errors from the API are shown in plain words", async () => {
	const user = userEvent.setup();
	await renderSettings({
		"PUT /api/settings": () =>
			json(400, { title: "One or more validation errors occurred.", errors: { RetentionDays: ["Keep between 1 and 365 days."] } }),
	});

	await user.click(control("button", "Save settings"));

	expect(await screen.findByText("Keep between 1 and 365 days.")).toBeTruthy();
	expect(screen.queryByText("Saved.")).toBeNull();
});

test("after saving, the cached settings are what the server stored", async () => {
	const user = userEvent.setup();
	const { queryClient } = await renderSettings({
		"PUT /api/settings": (call) => ({ ...call.body, mutedApps: ["com.normalised"] }),
	});

	await user.click(control("button", "Save settings"));
	await screen.findByText("Saved.");

	// The settings query holds the server's copy, so the next visit starts from what was actually stored.
	expect(queryClient.getQueryData(["settings"]).mutedApps).toEqual(["com.normalised"]);
});

// --- Delete account ----------------------------------------------------------------------------------------

const deleteButton = () => screen.getByRole("button", { name: /Delete my account|Deleting…/ });
const confirmBox = () => screen.getByRole("textbox", { name: /To confirm, type your email address/ });

test("deleting the account needs the user's email typed exactly (ignoring case and spaces)", async () => {
	const user = userEvent.setup();
	await renderSettings();
	await screen.findByText("Me@Example.com");

	expect(deleteButton().disabled).toBe(true);
	await user.type(confirmBox(), "me@example.co");
	expect(deleteButton().disabled).toBe(true);
	await user.type(confirmBox(), "m  ");
	expect(deleteButton().disabled).toBe(false);
});

test("pressing Enter before the email matches doesn't delete anything", async () => {
	const user = userEvent.setup();
	const { calls } = await renderSettings({ "DELETE /api/account": () => json(204) });
	await screen.findByText("Me@Example.com");

	await user.type(confirmBox(), "wrong@example.com{Enter}");

	expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
});

test("until the account email has loaded, deletion stays locked", async () => {
	const user = userEvent.setup();
	const gate = deferred();
	await renderSettings({ "GET /api/me": () => gate.promise });

	await user.type(confirmBox(), "me@example.com");

	expect(deleteButton().disabled).toBe(true);
	gate.resolve({ id: "u1", email: "me@example.com", createdAt: "2026-01-01T00:00:00Z" });
	await waitFor(() => expect(deleteButton().disabled).toBe(false));
});

test("a confirmed deletion signs out, forgets cached data and goes home", async () => {
	const user = userEvent.setup();
	const { calls, router, queryClient } = await renderSettings({ "DELETE /api/account": () => json(204) });
	await screen.findByText("Me@Example.com");

	await user.type(confirmBox(), "me@example.com");
	await user.click(deleteButton());

	await waitFor(() => expect(currentPath(router)).toBe("/"));
	expect(calls.filter((c) => c.method === "DELETE" && c.path === "/api/account")).toHaveLength(1);
	expect(localStorage.getItem("chime.tokens")).toBeNull();
	expect(queryClient.getQueryData(["settings"])).toBeUndefined();
	expect(queryClient.getQueryData(["me"])).toBeUndefined();
});

test("a failed deletion keeps the user signed in and explains", async () => {
	const user = userEvent.setup();
	const { router } = await renderSettings({
		"DELETE /api/account": () => json(500, { title: "Couldn't delete the account." }),
	});
	await screen.findByText("Me@Example.com");

	await user.type(confirmBox(), "me@example.com");
	await user.click(deleteButton());

	expect(await screen.findByText("Couldn't delete the account.")).toBeTruthy();
	expect(localStorage.getItem("chime.tokens")).not.toBeNull();
	expect(currentPath(router)).toBe("/settings");
});

test("the footer's #delete-account link scrolls to the card and focuses the confirmation box", async () => {
	const scrolled = [];
	const realScroll = HTMLElement.prototype.scrollIntoView;
	HTMLElement.prototype.scrollIntoView = function (options) {
		scrolled.push({ id: this.id, options });
	};
	try {
		await renderSettings({}, { url: "/settings#delete-account" });

		await waitFor(() => expect(document.activeElement).toBe(confirmBox()));
		expect(scrolled).toContainEqual({ id: "delete-account", options: { behavior: "smooth", block: "center" } });
	} finally {
		HTMLElement.prototype.scrollIntoView = realScroll;
	}
});

test("without the hash, the page doesn't jump to the danger zone", async () => {
	await renderSettings();
	expect(document.activeElement).not.toBe(confirmBox());
});
