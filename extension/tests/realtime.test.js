import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// --- Module stand-ins ---------------------------------------------------------------------------------------

const store = new Map();
mock.module("#imports", () => ({
	storage: {
		defineItem: (key, { fallback }) => ({
			getValue: async () => (store.has(key) ? structuredClone(store.get(key)) : fallback),
			setValue: async (value) => {
				if (value === null) store.delete(key);
				else store.set(key, structuredClone(value));
			},
			watch: () => () => {},
		}),
	},
}));

const apiState = { session: null, key: "BKey", keyError: null, saveError: null, saved: [], keyRequests: 0, tokenRequests: 0 };
mock.module("../lib/api", () => ({
	sessionItem: { getValue: async () => apiState.session, watch: () => () => {} },
	freshSession: async () => {
		apiState.tokenRequests++;
		if (!apiState.session) throw new Error("signed out");
		return apiState.session;
	},
	fetchWebPushKey: async () => {
		apiState.keyRequests++;
		if (apiState.keyError) throw apiState.keyError;
		return apiState.key;
	},
	saveWebPushSubscription: async (deviceId, endpoint, p256dh, auth) => {
		if (apiState.saveError) throw apiState.saveError;
		apiState.saved.push({ deviceId, endpoint, p256dh, auth });
	},
}));

// A scriptable SignalR: each built connection is recorded so tests can drive its lifecycle.
const hub = { connections: [], startResults: [] };
class FakeConnection {
	constructor(url, options, retryPolicy) {
		Object.assign(this, { url, options, retryPolicy, handlers: {}, started: 0, stopped: 0 });
		this.lifecycle = {};
	}
	on(name, handler) {
		this.handlers[name] = handler;
	}
	onreconnecting(fn) {
		this.lifecycle.reconnecting = fn;
	}
	onreconnected(fn) {
		this.lifecycle.reconnected = fn;
	}
	onclose(fn) {
		this.lifecycle.close = fn;
	}
	async start() {
		this.started++;
		const next = hub.startResults.shift() ?? "ok";
		if (next instanceof Promise) return next;
		if (next !== "ok") throw new Error(next);
	}
	async stop() {
		this.stopped++;
		if (this.failStop) throw new Error("stop failed");
	}
}
mock.module("@microsoft/signalr", () => ({
	LogLevel: { Warning: 3 },
	HubConnectionBuilder: class {
		withUrl(url, options) {
			this.url = url;
			this.options = options;
			return this;
		}
		withAutomaticReconnect(policy) {
			this.policy = policy;
			return this;
		}
		configureLogging() {
			return this;
		}
		build() {
			const conn = new FakeConnection(this.url, this.options, this.policy);
			hub.connections.push(conn);
			return conn;
		}
	},
}));

// A query string keeps this import distinct from background.test.js's mock of ../lib/realtime.
const { createRealtime, hubChannel, webPushChannel } = await import("../lib/realtime.ts?real");

// --- Helpers ------------------------------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const REGISTRATION_KEY = "local:webPushRegistration";
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const b64url = (bytes) =>
	btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const keyBytes = (seed) => Uint8Array.from({ length: 65 }, (_, i) => (i * 7 + seed) % 256);

function signIn(deviceId = "browser-1", apiUrl = "https://chime.test") {
	apiState.session = { apiUrl, deviceId, accessToken: `token-for-${deviceId}` };
}

/** A recording onChange/onStatus pair. */
function handlers() {
	const h = {
		statuses: [],
		changes: 0,
		onStatus: (live) => h.statuses.push(live),
		onChange: async () => {
			h.changes++;
		},
		get live() {
			return h.statuses.at(-1);
		},
	};
	return h;
}

/** A fake service worker scope with a push manager that hands out subscriptions. */
function fakeWorker() {
	const worker = { listeners: {}, subscribeCalls: [], current: null, nextEndpoint: 1, subscribeError: null };
	const makeSubscription = (applicationServerKey) => {
		const sub = {
			endpoint: `https://fcm.googleapis.com/fcm/send/sub-${worker.nextEndpoint++}`,
			options: { applicationServerKey: applicationServerKey?.buffer ?? null },
			unsubscribed: false,
			keys: { p256dh: "p256", auth: "auth" },
			toJSON() {
				return { endpoint: sub.endpoint, keys: sub.keys };
			},
			async unsubscribe() {
				sub.unsubscribed = true;
				if (worker.current === sub) worker.current = null;
				if (worker.unsubscribeError) throw worker.unsubscribeError;
				return true;
			},
		};
		return sub;
	};
	worker.registration = {
		pushManager: {
			getSubscription: async () => worker.current,
			subscribe: async (options) => {
				worker.subscribeCalls.push(options);
				if (worker.subscribeError) throw worker.subscribeError;
				const bytes = Uint8Array.from(
					atob(options.applicationServerKey.replace(/-/g, "+").replace(/_/g, "/")),
					(c) => c.charCodeAt(0),
				);
				worker.current = makeSubscription(bytes);
				return worker.current;
			},
		},
	};
	worker.addEventListener = (type, listener) => {
		worker.listeners[type] = listener;
	};
	/** Dispatches an extendable event and resolves when its waitUntil work is done. */
	worker.dispatch = async (type) => {
		const waits = [];
		worker.listeners[type]({ waitUntil: (p) => waits.push(p) });
		expect(waits).toHaveLength(1);
		await Promise.all(waits);
	};
	worker.preexisting = (bytes) => {
		worker.current = makeSubscription(bytes);
		return worker.current;
	};
	return worker;
}

const originalNow = Date.now;
const originalWarn = console.warn;
let warnings;
let clock;

beforeEach(() => {
	store.clear();
	Object.assign(apiState, {
		session: null,
		key: b64url(keyBytes(1)),
		keyError: null,
		saveError: null,
		saved: [],
		keyRequests: 0,
		tokenRequests: 0,
	});
	hub.connections.length = 0;
	hub.startResults.length = 0;
	clock = originalNow();
	Date.now = () => clock;
	warnings = [];
	console.warn = (...args) => warnings.push(args);
});
afterEach(() => {
	Date.now = originalNow;
	console.warn = originalWarn;
});

// --- Chrome: Web Push ---------------------------------------------------------------------------------------

describe("Web Push channel (Chrome)", () => {
	test("registers its push listeners as soon as it's created, before any start", () => {
		const worker = fakeWorker();
		webPushChannel(handlers(), worker);
		expect(Object.keys(worker.listeners).sort()).toEqual(["push", "pushsubscriptionchange"]);
	});

	test("signed out (or no device yet): stays offline and doesn't subscribe", async () => {
		const worker = fakeWorker();
		const h = handlers();
		const channel = webPushChannel(h, worker);

		await channel.start();
		apiState.session = { apiUrl: "https://chime.test", accessToken: "t" }; // no deviceId
		await channel.start();

		expect(h.statuses).toEqual([false, false]);
		expect(worker.subscribeCalls).toHaveLength(0);
		expect(apiState.keyRequests).toBe(0);
	});

	test("first start subscribes with the API's key and saves the subscription for this browser", async () => {
		signIn("browser-1");
		const worker = fakeWorker();
		const h = handlers();

		await webPushChannel(h, worker).start();

		expect(worker.subscribeCalls).toEqual([{ userVisibleOnly: false, applicationServerKey: apiState.key }]);
		expect(apiState.saved).toEqual([
			{ deviceId: "browser-1", endpoint: worker.current.endpoint, p256dh: "p256", auth: "auth" },
		]);
		expect(store.get(REGISTRATION_KEY)).toEqual({
			deviceId: "browser-1",
			endpoint: worker.current.endpoint,
			checkedAt: clock,
		});
		expect(h.statuses).toEqual([true]);
	});

	test("a worker restart within a day reuses the saved registration without calling the API", async () => {
		signIn();
		const worker = fakeWorker();
		await webPushChannel(handlers(), worker).start();
		apiState.keyRequests = 0;

		clock += DAY - 1000;
		const h = handlers();
		await webPushChannel(h, worker).start();

		expect(apiState.keyRequests).toBe(0);
		expect(apiState.saved).toHaveLength(1);
		expect(worker.subscribeCalls).toHaveLength(1);
		expect(h.statuses).toEqual([true]);
	});

	test("after a day it re-checks with the API but keeps a subscription whose key still matches", async () => {
		signIn();
		const worker = fakeWorker();
		await webPushChannel(handlers(), worker).start();
		const original = worker.current;

		clock += DAY + 1;
		await webPushChannel(handlers(), worker).start();

		expect(apiState.keyRequests).toBe(2);
		expect(worker.subscribeCalls).toHaveLength(1);
		expect(original.unsubscribed).toBe(false);
		expect(apiState.saved.map((s) => s.endpoint)).toEqual([original.endpoint, original.endpoint]);
		expect(store.get(REGISTRATION_KEY).checkedAt).toBe(clock);
	});

	test("a key with base64 padding still matches the subscription's key", async () => {
		signIn();
		const worker = fakeWorker();
		const bytes = keyBytes(1);
		worker.preexisting(bytes);
		apiState.key = `${b64url(bytes)}=`;

		await webPushChannel(handlers(), worker).start();

		expect(worker.subscribeCalls).toHaveLength(0);
		expect(apiState.saved).toHaveLength(1);
	});

	test("a rotated API key replaces the old subscription", async () => {
		signIn();
		const worker = fakeWorker();
		const old = worker.preexisting(keyBytes(9));
		const h = handlers();

		await webPushChannel(h, worker).start();

		expect(old.unsubscribed).toBe(true);
		expect(worker.subscribeCalls).toHaveLength(1);
		expect(apiState.saved[0].endpoint).toBe(worker.current.endpoint);
		expect(worker.current.endpoint).not.toBe(old.endpoint);
		expect(h.live).toBe(true);
	});

	test("an existing subscription without a server key is replaced", async () => {
		signIn();
		const worker = fakeWorker();
		const old = worker.preexisting(null);

		await webPushChannel(handlers(), worker).start();

		expect(old.unsubscribed).toBe(true);
		expect(worker.subscribeCalls).toHaveLength(1);
	});

	test("signing in as a different device re-saves even inside the daily window", async () => {
		signIn("browser-1");
		const worker = fakeWorker();
		await webPushChannel(handlers(), worker).start();

		signIn("browser-2");
		await webPushChannel(handlers(), worker).start();

		expect(apiState.saved.map((s) => s.deviceId)).toEqual(["browser-1", "browser-2"]);
		expect(worker.subscribeCalls).toHaveLength(1);
		expect(store.get(REGISTRATION_KEY).deviceId).toBe("browser-2");
	});

	test("a subscription the browser dropped is recreated even inside the daily window", async () => {
		signIn();
		const worker = fakeWorker();
		await webPushChannel(handlers(), worker).start();
		worker.current = null;

		await webPushChannel(handlers(), worker).start();

		expect(worker.subscribeCalls).toHaveLength(2);
		expect(apiState.saved).toHaveLength(2);
	});

	test("an API without Web Push turns the channel off and drops any subscription", async () => {
		signIn();
		const worker = fakeWorker();
		const old = worker.preexisting(keyBytes(1));
		store.set(REGISTRATION_KEY, { deviceId: "browser-1", endpoint: "x", checkedAt: 0 });
		apiState.key = null;
		const h = handlers();

		await webPushChannel(h, worker).start();

		expect(old.unsubscribed).toBe(true);
		expect(store.has(REGISTRATION_KEY)).toBe(false);
		expect(worker.subscribeCalls).toHaveLength(0);
		expect(h.statuses).toEqual([false]);
	});

	test.each([
		["the key request fails", () => { apiState.keyError = new Error("offline"); }],
		["the browser refuses to subscribe", (w) => { w.subscribeError = new Error("denied"); }],
		["the API rejects the subscription", () => { apiState.saveError = new Error("400"); }],
		["the subscription has no keys", (w) => {
			const subscribe = w.registration.pushManager.subscribe;
			w.registration.pushManager.subscribe = async (o) => {
				const s = await subscribe(o);
				s.keys = {};
				return s;
			};
		}],
	])("falls back to polling when %s, without throwing or saving a registration", async (_, breakIt) => {
		signIn();
		const worker = fakeWorker();
		breakIt(worker);
		const h = handlers();

		await webPushChannel(h, worker).start();

		expect(h.statuses).toEqual([false]);
		expect(store.has(REGISTRATION_KEY)).toBe(false);
		expect(warnings).toHaveLength(1);
	});

	test("a push wakes the worker and refreshes the feed before the event completes", async () => {
		const worker = fakeWorker();
		const h = handlers();
		let finished = false;
		h.onChange = async () => {
			await settle();
			finished = true;
		};
		webPushChannel(h, worker);

		await worker.dispatch("push");

		expect(finished).toBe(true);
	});

	test("when the browser rotates the subscription it re-subscribes and saves the new one", async () => {
		signIn();
		const worker = fakeWorker();
		const h = handlers();
		await webPushChannel(h, worker).start();
		const before = worker.current.endpoint;
		worker.current = null; // the browser dropped the old one

		await worker.dispatch("pushsubscriptionchange");

		expect(apiState.saved).toHaveLength(2);
		expect(apiState.saved[1].endpoint).not.toBe(before);
		expect(store.get(REGISTRATION_KEY).endpoint).toBe(apiState.saved[1].endpoint);
		expect(h.live).toBe(true);
	});

	test("stop goes offline, forgets the registration and unsubscribes", async () => {
		signIn();
		const worker = fakeWorker();
		const h = handlers();
		const channel = webPushChannel(h, worker);
		await channel.start();
		const sub = worker.current;

		await channel.stop();

		expect(h.statuses).toEqual([true, false]);
		expect(sub.unsubscribed).toBe(true);
		expect(store.has(REGISTRATION_KEY)).toBe(false);
	});

	test("stop tolerates there being no subscription, or unsubscribe failing", async () => {
		const worker = fakeWorker();
		const channel = webPushChannel(handlers(), worker);
		await channel.stop();

		signIn();
		await channel.start();
		worker.unsubscribeError = new Error("gone");
		await channel.stop();
	});
});

// --- Firefox: SignalR ---------------------------------------------------------------------------------------

describe("SignalR channel (Firefox)", () => {
	/** Captures setTimeout calls made by the channel so retries can be run by hand. */
	function captureTimers() {
		const realSet = globalThis.setTimeout;
		const realClear = globalThis.clearTimeout;
		const timers = [];
		globalThis.setTimeout = (fn, ms) => {
			if (ms === 0 || ms === undefined) return realSet(fn, ms);
			const t = { fn, ms, cleared: false };
			timers.push(t);
			return t;
		};
		globalThis.clearTimeout = (t) => {
			if (t && typeof t === "object" && "cleared" in t) t.cleared = true;
			else realClear(t);
		};
		return {
			timers,
			restore() {
				globalThis.setTimeout = realSet;
				globalThis.clearTimeout = realClear;
			},
		};
	}

	test("signed out: doesn't connect", async () => {
		const h = handlers();
		await hubChannel(h).start();
		expect(hub.connections).toHaveLength(0);
		expect(h.statuses).toEqual([false]);
	});

	test("connects to the signed-in API's hub, goes live and catches up", async () => {
		signIn("browser-1", "https://chime.test");
		const h = handlers();

		await hubChannel(h).start();

		const [conn] = hub.connections;
		expect(conn.url).toBe("https://chime.test/api/hubs/notifications");
		expect(conn.started).toBe(1);
		expect(h.statuses.at(-1)).toBe(true);
		await settle();
		expect(h.changes).toBe(1);
	});

	test("the hub always gets a fresh access token", async () => {
		signIn();
		await hubChannel(handlers()).start();
		const [conn] = hub.connections;

		apiState.session.accessToken = "rotated";
		expect(await conn.options.accessTokenFactory()).toBe("rotated");
		expect(apiState.tokenRequests).toBe(1);
	});

	test("new and dismissed notifications trigger a refresh, and handlers return nothing", async () => {
		signIn();
		const h = handlers();
		await hubChannel(h).start();
		await settle();
		const [conn] = hub.connections;
		h.changes = 0;

		expect(conn.handlers.NotificationReceived({ id: "n1" })).toBeUndefined();
		expect(conn.handlers.NotificationDismissed("n1")).toBeUndefined();
		await settle();

		expect(h.changes).toBe(2);
	});

	test("reconnecting goes offline; reconnecting successfully goes live and catches up", async () => {
		signIn();
		const h = handlers();
		await hubChannel(h).start();
		await settle();
		const [conn] = hub.connections;
		h.changes = 0;

		conn.lifecycle.reconnecting();
		expect(h.live).toBe(false);
		conn.lifecycle.reconnected();
		expect(h.live).toBe(true);
		await settle();
		expect(h.changes).toBe(1);
	});

	test("automatic reconnect backs off exponentially to a minute and never gives up", async () => {
		signIn();
		await hubChannel(handlers()).start();
		const { nextRetryDelayInMilliseconds: next } = hub.connections[0].retryPolicy;

		const delays = [0, 1, 2, 3, 4, 5, 6, 10, 100].map((n) => next({ previousRetryCount: n }));

		expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
	});

	test("a failed first connection is retried with backoff until it succeeds", async () => {
		const timers = captureTimers();
		try {
			signIn();
			hub.startResults.push("down", "still down");
			const h = handlers();

			await hubChannel(h).start();
			expect(h.live).toBe(false);
			expect(timers.timers.map((t) => t.ms)).toEqual([1000]);

			await timers.timers[0].fn();
			expect(timers.timers.map((t) => t.ms)).toEqual([1000, 2000]);

			await timers.timers[1].fn();
			expect(hub.connections).toHaveLength(1);
			expect(hub.connections[0].started).toBe(3);
			expect(h.live).toBe(true);
			expect(warnings).toHaveLength(2);
		} finally {
			timers.restore();
		}
	});

	test("starting again for the same API keeps the existing connection", async () => {
		signIn();
		const h = handlers();
		const channel = hubChannel(h);
		await channel.start();
		await channel.start();

		expect(hub.connections).toHaveLength(1);
		expect(hub.connections[0].stopped).toBe(0);
	});

	test("switching API server replaces the connection", async () => {
		signIn("browser-1", "https://one.test");
		const channel = hubChannel(handlers());
		await channel.start();

		signIn("browser-1", "https://two.test");
		await channel.start();

		expect(hub.connections.map((c) => c.url)).toEqual([
			"https://one.test/api/hubs/notifications",
			"https://two.test/api/hubs/notifications",
		]);
		expect(hub.connections[0].stopped).toBe(1);
	});

	test("signing out (start without a session) disconnects", async () => {
		signIn();
		const h = handlers();
		const channel = hubChannel(h);
		await channel.start();

		apiState.session = null;
		await channel.start();

		expect(hub.connections[0].stopped).toBe(1);
		expect(h.live).toBe(false);
	});

	test("stop cancels a pending retry, and a stale connection's late failure is ignored", async () => {
		const timers = captureTimers();
		try {
			signIn();
			let failLater;
			hub.startResults.push("down");
			const h = handlers();
			const channel = hubChannel(h);
			await channel.start();
			expect(timers.timers).toHaveLength(1);

			await channel.stop();
			expect(timers.timers[0].cleared).toBe(true);

			// A connection that was mid-start when stopped must not schedule retries or go live later.
			hub.startResults.push(new Promise((_, reject) => { failLater = reject; }));
			const second = hubChannel(h);
			const starting = second.start();
			await settle();
			await second.stop();
			failLater(new Error("late"));
			await starting;
			expect(timers.timers).toHaveLength(1);
			expect(h.live).toBe(false);
		} finally {
			timers.restore();
		}
	});

	test("a connection that finishes starting after stop doesn't go live", async () => {
		signIn();
		let finish;
		hub.startResults.push(new Promise((resolve) => { finish = resolve; }));
		const h = handlers();
		const channel = hubChannel(h);
		const starting = channel.start();
		await settle();

		await channel.stop();
		finish();
		await starting;

		expect(h.live).toBe(false);
		expect(h.changes).toBe(0);
	});

	test("only the current connection's close event takes the channel offline", async () => {
		signIn("browser-1", "https://one.test");
		const h = handlers();
		const channel = hubChannel(h);
		await channel.start();
		const stale = hub.connections[0];
		signIn("browser-1", "https://two.test");
		await channel.start();
		expect(h.live).toBe(true);

		stale.lifecycle.close();
		expect(h.live).toBe(true);

		hub.connections[1].lifecycle.close();
		expect(h.live).toBe(false);
	});

	test("a failing stop is swallowed", async () => {
		signIn();
		const channel = hubChannel(handlers());
		await channel.start();
		hub.connections[0].failStop = true;

		await channel.stop();
	});
});

// --- createRealtime ---------------------------------------------------------------------------------------------

describe("createRealtime", () => {
	test("runs start and stop one at a time, in call order", async () => {
		const log = [];
		let release;
		const slow = new Promise((r) => { release = r; });
		const channel = {
			start: async () => {
				log.push("start:begin");
				await slow;
				log.push("start:end");
			},
			stop: async () => {
				log.push("stop");
			},
		};
		const realtime = createRealtime(handlers(), channel);

		const a = realtime.start();
		const b = realtime.stop();
		const c = realtime.start();
		await settle();
		expect(log).toEqual(["start:begin"]);

		release();
		await Promise.all([a, b, c]);
		expect(log).toEqual(["start:begin", "start:end", "stop", "start:begin", "start:end"]);
	});

	test("a failed start doesn't block later calls", async () => {
		let calls = 0;
		const realtime = createRealtime(handlers(), {
			start: async () => {
				calls++;
				if (calls === 1) throw new Error("boom");
			},
			stop: async () => {},
		});

		await realtime.start().catch(() => {});
		await realtime.start();

		expect(calls).toBe(2);
	});

	test("concurrent starts on the Web Push channel subscribe once", async () => {
		signIn();
		const worker = fakeWorker();
		const realtime = createRealtime(handlers(), webPushChannel(handlers(), worker));

		await Promise.all([realtime.start(), realtime.start(), realtime.start()]);

		expect(worker.subscribeCalls).toHaveLength(1);
		expect(apiState.saved).toHaveLength(1);
	});
});
