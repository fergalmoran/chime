import { Link } from "@tanstack/react-router";
import { useIsAuthenticated } from "#/lib/hooks";

export function SiteFooter() {
	const authed = useIsAuthenticated();

	return (
		<footer className="sticky bottom-0 z-10 border-t bg-background/80 backdrop-blur">
			<div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 text-sm text-muted-foreground">
				<span>© {new Date().getFullYear()} Chime</span>
				<nav className="flex items-center gap-4">
					<Link to="/privacy" className="hover:text-foreground">
						Privacy
					</Link>
					{authed && (
						<Link
							to="/settings"
							hash="delete-account"
							className="hover:text-destructive"
						>
							Delete account
						</Link>
					)}
				</nav>
			</div>
		</footer>
	);
}
