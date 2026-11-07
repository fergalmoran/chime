import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { SignInButton } from "#/components/sign-in-button";
import { ApiError, describeError } from "#/lib/api";
import { completeGoogleSignIn } from "#/lib/google-auth";

/** Google redirects back here with the ID token in the URL fragment. */
export const Route = createFileRoute("/auth/callback")({
	ssr: false,
	component: AuthCallback,
});

function AuthCallback() {
	const navigate = useNavigate();
	const [error, setError] = useState<string | null>(null);
	const started = useRef(false);

	useEffect(() => {
		// The pending sign-in is single-use, so guard against StrictMode's double run.
		if (started.current) return;
		started.current = true;
		const hash = window.location.hash;
		window.history.replaceState(null, "", window.location.pathname);
		completeGoogleSignIn(hash)
			.then((returnTo) => navigate({ href: returnTo, replace: true }))
			.catch((e) => setError(describeSignInError(e)));
	}, [navigate]);

	return (
		<main className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
			{error ? (
				<>
					<p role="alert" className="text-destructive">
						{error}
					</p>
					<SignInButton>Try again</SignInButton>
				</>
			) : (
				<p className="text-muted-foreground">Signing you in…</p>
			)}
		</main>
	);
}

function describeSignInError(error: unknown) {
	if (error instanceof ApiError) {
		const detail = (error.details as { detail?: string } | undefined)?.detail;
		if (detail) return detail;
	}
	return describeError(error);
}
