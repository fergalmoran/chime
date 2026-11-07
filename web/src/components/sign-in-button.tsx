import type { ComponentProps } from "react";
import { SiGoogle } from "react-icons/si";
import { Button } from "#/components/ui/button";
import { GOOGLE_CLIENT_ID } from "#/lib/api";
import { startGoogleSignIn } from "#/lib/google-auth";

/** Sends the user straight to Google to sign in (or create their account). */
export function SignInButton({
	returnTo,
	children = "Sign in",
	...props
}: ComponentProps<typeof Button> & { returnTo?: string }) {
	return (
		<Button
			{...props}
			disabled={!GOOGLE_CLIENT_ID}
			title={
				GOOGLE_CLIENT_ID
					? undefined
					: "Google sign-in isn't configured (VITE_GOOGLE_CLIENT_ID)"
			}
			onClick={() => startGoogleSignIn(returnTo)}
		>
			<SiGoogle />
			{children}
		</Button>
	);
}
