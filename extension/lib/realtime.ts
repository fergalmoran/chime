import { type HubConnection, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { storage } from '#imports';
import { fetchWebPushKey, freshSession, saveWebPushSubscription, sessionItem } from '@/lib/api';

/**
 * A channel that tells the background when the user's feed changed, so it can refresh straight away instead of
 * waiting for the next poll. Chrome (MV3 service worker) uses Web Push, which wakes a suspended worker; Firefox
 * extensions can't use Web Push yet (bug 1378096), so its persistent MV2 background page holds a SignalR
 * connection open instead.
 */
export interface Realtime {
  /** Connects or subscribes for the signed-in user. Safe to call repeatedly. */
  start(): Promise<void>;
  /** Disconnects or unsubscribes, e.g. on sign-out. */
  stop(): Promise<void>;
}

export interface RealtimeHandlers {
  /** The feed changed (or may have changed while disconnected); refresh it. */
  onChange: () => Promise<void>;
  /** Whether the channel is currently live, so the fallback poll can slow down. */
  onStatus: (live: boolean) => void;
}

export function createRealtime(
  handlers: RealtimeHandlers,
  channel: Realtime = import.meta.env.MANIFEST_VERSION === 3 ? webPushChannel(handlers) : hubChannel(handlers),
): Realtime {
  // Startup and sign-in can both start the channel at once; run start/stop one at a time.
  let queue = Promise.resolve();
  const serial = (fn: () => Promise<void>) => () => (queue = queue.then(fn, fn));
  return { start: serial(channel.start), stop: serial(channel.stop) };
}

// --- Chrome: Web Push ---------------------------------------------------------------------------------------

interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

/** The parts of the service worker's global scope Web Push needs (injectable for tests). */
export interface WorkerScope {
  registration: ServiceWorkerRegistration;
  addEventListener(type: 'push' | 'pushsubscriptionchange', listener: (event: ExtendableEvent) => void): void;
}

interface Registration {
  deviceId: string;
  endpoint: string;
  checkedAt: number;
}

/** The subscription last saved to the API, so a worker woken by a push doesn't re-register every time. */
const registrationItem = storage.defineItem<Registration | null>('local:webPushRegistration', { fallback: null });

/** Re-verify with the API once a day in case it rotated its VAPID key or forgot the subscription. */
const RECHECK_MS = 24 * 60 * 60 * 1000;

export function webPushChannel(
  { onChange, onStatus }: RealtimeHandlers,
  worker: WorkerScope = globalThis as unknown as WorkerScope,
): Realtime {
  // Service worker events must be registered synchronously during the worker's first evaluation.
  worker.addEventListener('push', (event) => event.waitUntil(onChange()));
  worker.addEventListener('pushsubscriptionchange', (event) =>
    event.waitUntil(registrationItem.setValue(null).then(subscribe)));

  async function subscribe() {
    try {
      const session = await sessionItem.getValue();
      if (!session?.deviceId) return onStatus(false);

      const manager = worker.registration.pushManager;
      let subscription = await manager.getSubscription();
      const saved = await registrationItem.getValue();
      if (subscription && saved?.deviceId === session.deviceId && saved.endpoint === subscription.endpoint
        && Date.now() - saved.checkedAt < RECHECK_MS) {
        return onStatus(true);
      }

      const key = await fetchWebPushKey();
      if (!key) {
        await subscription?.unsubscribe();
        await registrationItem.setValue(null);
        return onStatus(false);
      }
      if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
        await subscription.unsubscribe();
        subscription = null;
      }
      // userVisibleOnly: false is allowed for extensions with the "notifications" permission (Chrome 121+).
      subscription ??= await manager.subscribe({ userVisibleOnly: false, applicationServerKey: key });

      const { endpoint, keys } = subscription.toJSON();
      if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error('Push subscription is missing its keys.');
      await saveWebPushSubscription(session.deviceId, endpoint, keys.p256dh, keys.auth);
      await registrationItem.setValue({ deviceId: session.deviceId, endpoint, checkedAt: Date.now() });
      onStatus(true);
    } catch (err) {
      console.warn('Chime Web Push unavailable; polling instead', err);
      onStatus(false);
    }
  }

  return {
    start: subscribe,
    async stop() {
      onStatus(false);
      await registrationItem.setValue(null);
      // The API clears the stored subscription once the push service reports it gone.
      await (await worker.registration.pushManager.getSubscription())?.unsubscribe().catch(() => false);
    },
  };
}

function sameKey(current: ArrayBuffer | null, base64url: string) {
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return toBase64Url(bytes) === base64url.replace(/=+$/, '');
}

function toBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// --- Firefox: SignalR ---------------------------------------------------------------------------------------

const MAX_RETRY_MS = 60_000;
const retryDelay = (attempt: number) => Math.min(MAX_RETRY_MS, 1000 * 2 ** attempt);

export function hubChannel({ onChange, onStatus }: RealtimeHandlers): Realtime {
  let connection: HubConnection | undefined;
  let apiUrl: string | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  async function connect(conn: HubConnection, attempt: number) {
    try {
      await conn.start();
      if (conn !== connection) return;
      onStatus(true);
      // Catch up on anything that arrived while disconnected.
      void onChange();
    } catch (err) {
      if (conn !== connection) return;
      console.warn('Chime live connection failed; retrying', err);
      retryTimer = setTimeout(() => void connect(conn, attempt + 1), retryDelay(attempt));
    }
  }

  async function stop() {
    clearTimeout(retryTimer);
    const conn = connection;
    connection = undefined;
    apiUrl = undefined;
    onStatus(false);
    await conn?.stop().catch(() => undefined);
  }

  return {
    async start() {
      const session = await sessionItem.getValue();
      if (!session) return stop();
      if (connection && apiUrl === session.apiUrl) return;
      await stop();

      const conn = new HubConnectionBuilder()
        .withUrl(`${session.apiUrl}/api/hubs/notifications`, {
          accessTokenFactory: async () => (await freshSession()).accessToken,
        })
        // Always returning a delay means it never gives up reconnecting.
        .withAutomaticReconnect({ nextRetryDelayInMilliseconds: (ctx) => retryDelay(ctx.previousRetryCount) })
        .configureLogging(LogLevel.Warning)
        .build();
      // Handlers must not return a value, or SignalR treats it as a client result.
      conn.on('NotificationReceived', () => { void onChange(); });
      conn.on('NotificationDismissed', () => { void onChange(); });
      conn.onreconnecting(() => onStatus(false));
      conn.onreconnected(() => {
        onStatus(true);
        void onChange();
      });
      conn.onclose(() => {
        if (conn === connection) onStatus(false);
      });

      connection = conn;
      apiUrl = session.apiUrl;
      await connect(conn, 0);
    },
    stop,
  };
}
