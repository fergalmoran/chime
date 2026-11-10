// Test preload (bunfig.toml): a real DOM (happy-dom) for every web test, registered before anything imports
// React or Testing Library, plus a clean slate after each test.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach } from "bun:test";

GlobalRegistrator.register({ url: "https://chime.test/" });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// happy-dom leaves this undefined; the test origin is https, as production is.
globalThis.isSecureContext = true;

const realFetch = globalThis.fetch;

afterEach(async () => {
	const { cleanup } = await import("@testing-library/react/pure");
	cleanup();
	localStorage.clear();
	sessionStorage.clear();
	document.documentElement.className = "";
	window.history.replaceState(null, "", "/");
	globalThis.fetch = realFetch;
});
