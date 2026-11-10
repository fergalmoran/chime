// Rendering helpers for component and page tests: a scripted API behind fetch, a fresh QueryClient and a small
// in-memory TanStack router, so pages render exactly as they do in the app without the full route tree.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { act, render, screen } from "@testing-library/react";

export const TOKEN_KEY = "chime.tokens";

/** Signs the browser in by storing API tokens the way api.ts does. */
export function signIn(access = "access-1") {
	localStorage.setItem(
		TOKEN_KEY,
		JSON.stringify({ accessToken: access, refreshToken: "refresh-1", expiresAt: Date.now() + 3_600_000 }),
	);
}

export function json(status, body) {
	return new Response(body === undefined ? null : JSON.stringify(body), {
		status,
		headers: body === undefined ? {} : { "Content-Type": "application/json" },
	});
}

/**
 * Replaces fetch with a scripted API. Routes map "METHOD /path" to a handler (call, n) => Response | value,
 * where n counts calls to that route. Returns the call log; unknown routes 404.
 */
export function mockApi(routes = {}) {
	const calls = [];
	globalThis.fetch = async (input, init = {}) => {
		const url = new URL(String(input));
		const method = init.method ?? "GET";
		const call = {
			method,
			path: url.pathname,
			query: url.searchParams,
			body: init.body ? JSON.parse(init.body) : undefined,
			auth: new Headers(init.headers).get("Authorization"),
		};
		calls.push(call);
		const handler = routes[`${method} ${url.pathname}`];
		if (!handler) return json(404, { title: "Not Found" });
		const n = calls.filter((c) => c.method === method && c.path === url.pathname).length;
		const result = await handler(call, n);
		return result instanceof Response ? result : json(200, result);
	};
	return calls;
}

export function newQueryClient() {
	return new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
	});
}

/** Renders plain components that don't need a router. */
export function renderWithQuery(ui, queryClient = newQueryClient()) {
	return { queryClient, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

/**
 * Renders `component` at `path` inside a memory router (plus simple "/", "/settings" and "/privacy" stand-ins
 * when they aren't the page under test), and waits for the first navigation to settle.
 * Returns the router so tests can assert on where the page navigated.
 */
export async function renderPage(component, { path = "/", url = path, queryClient = newQueryClient(), shell } = {}) {
	const root = createRootRoute({
		component: () => (shell ? shell(<Outlet />) : <Outlet />),
	});
	const routes = [createRoute({ getParentRoute: () => root, path, component })];
	for (const [stubPath, text] of [
		["/", "Home page"],
		["/settings", "Settings page"],
		["/privacy", "Privacy page"],
		["/devices", "Devices page"],
	]) {
		if (stubPath !== path) {
			routes.push(createRoute({ getParentRoute: () => root, path: stubPath, component: () => <p>{text}</p> }));
		}
	}
	const router = createRouter({
		routeTree: root.addChildren(routes),
		history: createMemoryHistory({ initialEntries: [url] }),
	});
	let utils;
	await act(async () => {
		utils = render(
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>,
		);
		await router.load();
	});
	return { router, queryClient, ...utils };
}

export const currentPath = (router) => router.state.location.pathname;

export { screen };
