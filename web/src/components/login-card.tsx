import { GoogleSignInButton } from "#/components/google-sign-in";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card";
import { GOOGLE_CLIENT_ID } from "#/lib/api";

/** Google is the only way to sign in; first sign-in creates the account. */
export function LoginCard({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
	return (
		<main className="flex justify-center px-4 py-16">
			<Card className="w-full max-w-sm">
				<CardHeader>
					<CardTitle>Welcome to Chime</CardTitle>
					<CardDescription>
						Sign in with your Google account to manage your devices and
						settings. New here? Signing in creates your account.
					</CardDescription>
				</CardHeader>
				<CardContent className="mt-6">
					{GOOGLE_CLIENT_ID ? (
						<GoogleSignInButton text="continue_with" onSignedIn={onSignedIn} />
					) : (
						<p role="alert" className="text-sm text-destructive">
							Google sign-in isn't configured. Set VITE_GOOGLE_CLIENT_ID in
							web/.env.
						</p>
					)}
				</CardContent>
			</Card>
		</main>
	);
}
