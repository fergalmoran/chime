// Helpers for testing the web app's lib modules. The DOM itself (window, storage, location) is happy-dom from
// the test preload (tests/dom.js), which also resets storage and fetch after each test.

/**
 * Scripts fetch and records full-page redirects. `routes` maps "METHOD /path" to a handler
 * (call, n) => Response | value, where n counts calls to that path.
 */
export function installBrowser({ routes = {} } = {}) {
	const calls = [];
	const assigned = [];
	window.location.assign = (url) => assigned.push(String(url));
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

/** Kept for symmetry in afterEach blocks; the preload does the real reset. */
export function uninstallBrowser() {}
