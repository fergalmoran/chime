import { Link, useNavigate } from "@tanstack/react-router";
import { ChimeLogo } from "#/components/chime-logo";
import { SignInButton } from "#/components/sign-in-button";
import { ThemeToggle } from "#/components/theme-toggle";
import { Button } from "#/components/ui/button";
import { authStore } from "#/lib/api";
import { useIsAuthenticated } from "#/lib/hooks";

export function SiteHeader() {
	const authed = useIsAuthenticated();
	const navigate = useNavigate();

	return (
		<header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
			<div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
				<Link to="/" className="flex items-center gap-2 font-semibold">
					<ChimeLogo className="size-7" />
					Chime
				</Link>
				<nav className="flex items-center gap-2">
					<ThemeToggle />
					{authed ? (
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								authStore.logout();
								navigate({ to: "/" });
							}}
						>
							Log out
						</Button>
					) : (
						<SignInButton size="sm" />
					)}
				</nav>
			</div>
		</header>
	);
}
