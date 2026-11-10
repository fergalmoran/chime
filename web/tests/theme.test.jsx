import "./render.jsx";
import { expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeToggle } from "../src/components/theme-toggle.tsx";
import { themeInitScript } from "../src/lib/theme.ts";

const isDark = () => document.documentElement.classList.contains("dark");

/** Runs the inline <head> script with a given saved choice and OS preference. */
function runInitScript({ saved = null, osDark = false, storageThrows = false } = {}) {
	if (saved) localStorage.setItem("chime-theme", saved);
	const realMatchMedia = globalThis.matchMedia;
	const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
	globalThis.matchMedia = (query) => ({ matches: query === "(prefers-color-scheme: dark)" && osDark });
	if (storageThrows) {
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			get() {
				throw new Error("blocked");
			},
		});
	}
	try {
		new Function(themeInitScript)();
	} finally {
		globalThis.matchMedia = realMatchMedia;
		if (storageThrows) Object.defineProperty(globalThis, "localStorage", storage);
	}
}

test.each([
	[{ saved: "dark" }, true],
	[{ saved: "light", osDark: true }, false],
	[{ osDark: true }, true],
	[{ osDark: false }, false],
])("the head script picks the theme before paint: %p -> dark=%p", (setup, dark) => {
	runInitScript(setup);
	expect(isDark()).toBe(dark);
});

test("the head script never throws, even when storage is blocked", () => {
	expect(() => runInitScript({ storageThrows: true })).not.toThrow();
	expect(isDark()).toBe(false);
});

test("the toggle switches theme, saves the choice and relabels itself", async () => {
	const user = userEvent.setup();
	render(<ThemeToggle />);

	await user.click(screen.getByRole("button", { name: "Switch to dark mode" }));
	expect(isDark()).toBe(true);
	expect(localStorage.getItem("chime-theme")).toBe("dark");

	await user.click(screen.getByRole("button", { name: "Switch to light mode" }));
	expect(isDark()).toBe(false);
	expect(localStorage.getItem("chime-theme")).toBe("light");
});

test("the toggle reflects a theme already applied by the head script", () => {
	document.documentElement.classList.add("dark");
	render(<ThemeToggle />);
	expect(screen.getByRole("button", { name: "Switch to light mode" })).toBeTruthy();
});

test("every toggle on the page stays in sync", async () => {
	const user = userEvent.setup();
	render(
		<>
			<ThemeToggle />
			<ThemeToggle />
		</>,
	);

	await user.click(screen.getAllByRole("button")[0]);

	expect(screen.getAllByRole("button", { name: "Switch to light mode" })).toHaveLength(2);
});

test("the theme still switches for this page view when storage is unavailable", async () => {
	const user = userEvent.setup();
	const realSetItem = localStorage.setItem;
	localStorage.setItem = () => {
		throw new Error("quota");
	};
	try {
		render(<ThemeToggle />);
		await user.click(screen.getByRole("button"));
		expect(isDark()).toBe(true);
	} finally {
		localStorage.setItem = realSetItem;
	}
});
