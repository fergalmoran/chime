import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LoginCard } from "#/components/login-card";

export const Route = createFileRoute("/login")({
	validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
		redirect:
			typeof search.redirect === "string" &&
			search.redirect.startsWith("/") &&
			!search.redirect.startsWith("//")
				? search.redirect
				: undefined,
	}),
	component: Login,
});

function Login() {
	const navigate = useNavigate();
	const { redirect } = Route.useSearch();
	return (
		<LoginCard onSignedIn={() => navigate({ href: redirect ?? "/app" })} />
	);
}
