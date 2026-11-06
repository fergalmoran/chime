import { Link, useNavigate } from "@tanstack/react-router";
import { BellRing } from "lucide-react";
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
					<BellRing className="size-5 text-primary" />
					Chime
				</Link>
				<nav className="flex items-center gap-2">
					{authed ? (
						<>
							<Button asChild variant="ghost" size="sm">
								<Link to="/app">Dashboard</Link>
							</Button>
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
						</>
					) : (
						<>
							<Button asChild size="sm">
								<Link to="/login">Sign in</Link>
							</Button>
						</>
					)}
				</nav>
			</div>
		</header>
	);
}
