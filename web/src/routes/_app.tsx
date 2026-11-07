import {
	createFileRoute,
	Link,
	Outlet,
	redirect,
} from "@tanstack/react-router";
import { DesktopNotifications } from "#/components/desktop-notifications";
import { LandingPage } from "#/components/landing-page";
import { authStore } from "#/lib/api";
import { useIsAuthenticated, useLiveNotifications } from "#/lib/hooks";

/**
 * Pathless layout for "/", "/devices" and "/settings".
 *
 * Signed in, it renders the dashboard shell around the page. Signed out, "/"
 * shows the landing page (with its Sign in button) and every other page
 * redirects back to "/".
 */
export const Route = createFileRoute("/_app")({
	// Auth tokens live in localStorage, so only the client can decide what to show.
	ssr: false,
	beforeLoad: ({ location }) => {
		if (!authStore.isAuthenticated() && location.pathname !== "/") {
			throw redirect({ to: "/" });
		}
	},
	component: AppLayout,
});

const tabs = [
	{ to: "/", label: "Notifications" },
	{ to: "/devices", label: "Devices" },
	{ to: "/settings", label: "Settings" },
] as const;

function AppLayout() {
	const authed = useIsAuthenticated();
	return authed ? <Dashboard /> : <LandingPage />;
}

function Dashboard() {
	useLiveNotifications();
	return (
		<main className="mx-auto max-w-5xl px-4 py-8">
			<nav className="mb-6 flex gap-1 border-b">
				{tabs.map((tab) => (
					<Link
						key={tab.to}
						to={tab.to}
						activeOptions={{ exact: true }}
						className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
						activeProps={{ className: "border-primary! text-foreground!" }}
					>
						{tab.label}
					</Link>
				))}
			</nav>
			<DesktopNotifications />
			<Outlet />
		</main>
	);
}
