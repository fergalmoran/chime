import { expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";

// No Google client ID baked into the build (VITE_GOOGLE_CLIENT_ID unset).
delete process.env.VITE_GOOGLE_CLIENT_ID;
const { SignInButton } = await import("../src/components/sign-in-button.tsx");
const { startGoogleSignIn } = await import("../src/lib/google-auth.ts");

test("Sign in is disabled and says why when Google sign-in isn't configured", () => {
	render(<SignInButton />);
	const button = screen.getByRole("button", { name: "Sign in" });
	expect(button.disabled).toBe(true);
	expect(button.getAttribute("title")).toBe("Google sign-in isn't configured (VITE_GOOGLE_CLIENT_ID)");
});

test("starting sign-in without a client ID fails loudly instead of redirecting", () => {
	const assigned = [];
	window.location.assign = (url) => assigned.push(url);
	expect(() => startGoogleSignIn("/")).toThrow("Google sign-in is not configured.");
	expect(assigned).toHaveLength(0);
});
