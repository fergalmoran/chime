// Minimal browser globals for testing the web app's lib modules under bun.

export function createStorage(initial = {}) {
	const data = new Map(Object.entries(initial));
	return {
		getItem: (k) => (data.has(k) ? data.get(k) : null),
		setItem: (k, v) => data.set(k, String(v)),
		removeItem: (k) => data.delete(k),
		clear: () => data.clear(),
		get size() {
			return data.size;
		},
	};
}

/**
 * Installs window/localStorage/sessionStorage and a scripted fetch.
 * `routes` maps "METHOD /path" to a handler (request, call) => Response | object.
 */
export function installBrowser({ routes = {}, origin = "https://chime.test" } = {}) {
	const calls = [];
	const localStorage = createStorage();
	const sessionStorage = createStorage();
	const assigned = [];
	globalThis.window = {
		localStorage,
		sessionStorage,
		location: { origin, assign: (url) => assigned.push(url) },
	};
	globalThis.localStorage = localStorage;
	globalThis.sessionStorage = sessionStorage;
	globalThis.fetch = async (input, init = {}) => {
		const url = new URL(String(input));
		const method = init.method ?? "GET";
		const headers = new Headers(init.headers);
		const call = {
			method,
			path: url.pathname,
			search: url.search,
			headers,
			body: init.body ? JSON.parse(init.body) : undefined,
		};
		calls.push(call);
		const handler = routes[`${method} ${url.pathname}`];
		if (!handler) return json(404, { title: "Not Found" });
		const result = await handler(call, calls.filter((c) => c.path === url.pathname).length);
		return result instanceof Response ? result : json(200, result);
	};
	return { calls, localStorage, sessionStorage, assigned };
}

export function json(status, body) {
	return new Response(body === undefined ? null : JSON.stringify(body), {
		status,
		headers: body === undefined ? {} : { "Content-Type": "application/json" },
	});
}

export function uninstallBrowser() {
	delete globalThis.window;
	delete globalThis.localStorage;
	delete globalThis.sessionStorage;
}
