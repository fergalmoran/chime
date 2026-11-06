import {
	createFileRoute,
	Link,
	Outlet,
	redirect,
} from "@tanstack/react-router";
import { DesktopNotifications } from "#/components/desktop-notifications";
import { authStore } from "#/lib/api";
import { useLiveNotifications } from "#/lib/hooks";

export const Route = createFileRoute("/app")({
	// Auth tokens live in localStorage, so the dashboard is rendered client-side only.
	ssr: false,
	beforeLoad: ({ location }) => {
		if (!authStore.isAuthenticated()) {
			throw redirect({ to: "/login", search: { redirect: location.href } });
		}
	},
	component: AppLayout,
});

const tabs = [
	{ to: "/app", label: "Notifications" },
	{ to: "/app/devices", label: "Devices" },
	{ to: "/app/settings", label: "Settings" },
] as const;

function AppLayout() {
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
