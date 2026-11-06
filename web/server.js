// Production server for the built app: `bun run build && bun server.js`.
// Serves the static client build (dist/client) and hands every other request to the
// TanStack Start SSR handler (dist/server/server.js). Plain JS so the app's
// tsconfig (DOM/Vite types only) doesn't need Bun's types.
import { resolve, sep } from "node:path";
import app from "./dist/server/server.js";

const clientDir = resolve(import.meta.dir, "dist/client");
const port = Number(process.env.PORT ?? 3000);

async function staticFile(pathname) {
	if (pathname === "/" || pathname.endsWith("/")) return null;
	let decoded;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return null;
	}
	const path = resolve(clientDir, `.${decoded}`);
	// Never serve anything outside dist/client (e.g. /../server/...).
	if (!path.startsWith(clientDir + sep)) return null;
	const file = Bun.file(path);
	if (!(await file.exists())) return null;
	// Vite fingerprints everything under /assets, so it can be cached forever.
	const cacheControl = pathname.startsWith("/assets/")
		? "public, max-age=31536000, immutable"
		: "public, max-age=3600";
	return new Response(file, { headers: { "Cache-Control": cacheControl } });
}

const server = Bun.serve({
	port,
	hostname: "0.0.0.0",
	async fetch(request) {
		const { pathname } = new URL(request.url);
		if (request.method === "GET" || request.method === "HEAD") {
			const response = await staticFile(pathname);
			if (response) return response;
		}
		return app.fetch(request);
	},
});

console.log(`chime web listening on http://${server.hostname}:${server.port}`);
