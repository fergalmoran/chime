import { useEffect, useRef, useState } from "react";
import { ApiError, api, describeError, GOOGLE_CLIENT_ID } from "#/lib/api";

interface GoogleCredentialResponse {
	credential: string;
}

interface GoogleIdentity {
	accounts: {
		id: {
			initialize(config: {
				client_id: string;
				callback: (response: GoogleCredentialResponse) => void;
				ux_mode?: "popup" | "redirect";
			}): void;
			renderButton(
				parent: HTMLElement,
				options: Record<string, string | number>,
			): void;
		};
	};
}

declare global {
	interface Window {
		google?: GoogleIdentity;
	}
}

const SCRIPT_SRC = "https://accounts.google.com/gsi/client";
let scriptPromise: Promise<GoogleIdentity> | null = null;

function loadGoogleIdentity(): Promise<GoogleIdentity> {
	scriptPromise ??= new Promise((resolve, reject) => {
		if (window.google) return resolve(window.google);
		const script = document.createElement("script");
		script.src = SCRIPT_SRC;
		script.async = true;
		script.onload = () =>
			window.google
				? resolve(window.google)
				: reject(new Error("Google sign-in failed to load."));
		script.onerror = () => {
			scriptPromise = null;
			reject(new Error("Google sign-in failed to load."));
		};
		document.head.appendChild(script);
	});
	return scriptPromise;
}

function describeGoogleError(error: unknown) {
	if (error instanceof ApiError) {
		const detail = (error.details as { detail?: string } | undefined)?.detail;
		if (detail) return detail;
	}
	return describeError(error);
}

interface GoogleSignInButtonProps {
	text: "signin_with" | "signup_with" | "continue_with";
	onSignedIn: () => Promise<void>;
}

/** Renders Google's "Sign in with Google" button. Renders nothing when no client ID is configured. */
export function GoogleSignInButton({
	text,
	onSignedIn,
}: GoogleSignInButtonProps) {
	const container = useRef<HTMLDivElement>(null);
	const [error, setError] = useState<string | null>(null);
	const onSignedInRef = useRef(onSignedIn);
	onSignedInRef.current = onSignedIn;

	useEffect(() => {
		if (!GOOGLE_CLIENT_ID) return;
		let cancelled = false;
		loadGoogleIdentity()
			.then((google) => {
				if (cancelled || !container.current) return;
				google.accounts.id.initialize({
					client_id: GOOGLE_CLIENT_ID as string,
					ux_mode: "popup",
					callback: ({ credential }) => {
						setError(null);
						api
							.loginWithGoogle(credential)
							.then(() => onSignedInRef.current())
							.catch((e) => setError(describeGoogleError(e)));
					},
				});
				google.accounts.id.renderButton(container.current, {
					type: "standard",
					theme: "outline",
					size: "large",
					shape: "rectangular",
					text,
					width: container.current.clientWidth || 320,
				});
			})
			.catch((e) => !cancelled && setError(describeGoogleError(e)));
		return () => {
			cancelled = true;
		};
	}, [text]);

	if (!GOOGLE_CLIENT_ID) return null;

	return (
		<div className="grid gap-2">
			<div ref={container} className="flex min-h-10 w-full justify-center" />
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
		</div>
	);
}
