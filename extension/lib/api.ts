import { storage } from '#imports';
import { browser } from 'wxt/browser';

export const DEFAULT_API_URL = 'https://chime.dev.fergl.ie:5002';

export interface Session {
  apiUrl: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  deviceId?: string;
}

export interface SyncedNotification {
  id: string;
  appId: string;
  appName: string | null;
  category: 'Other' | 'Message' | 'Sms' | 'Email' | 'Call';
  title: string | null;
  body: string | null;
  postedAt: string;
  receivedAt: string;
}

export interface MobileDevice {
  id: string;
  name: string;
  platform: 'Android' | 'Browser' | 'Web';
  canReceiveLinks: boolean;
}

interface NotificationPage {
  items: SyncedNotification[];
  nextBefore: string | null;
}

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export const sessionItem = storage.defineItem<Session | null>('local:session', { fallback: null });
/** Receive time of the newest notification the user has been alerted about. */
export const lastSeenItem = storage.defineItem<string | null>('local:lastSeen', { fallback: null });

/** Google OAuth web client ID; Google sign-in is hidden when unset. */
export const GOOGLE_CLIENT_ID = (import.meta.env.WXT_GOOGLE_CLIENT_ID as string | undefined) || undefined;

export class ApiError extends Error {
  constructor(public status: number, message?: string) {
    super(message ?? (status === 401 ? 'Please sign in again.' : `Request failed (${status}).`));
  }
}

const normalise = (url: string) => url.trim().replace(/\/+$/, '');

function toSession(base: Omit<Session, 'accessToken' | 'refreshToken' | 'expiresAt'>, t: TokenResponse): Session {
  return { ...base, accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: Date.now() + t.expiresIn * 1000 };
}

function browserName() {
  return import.meta.env.FIREFOX ? 'Firefox' : 'Chrome';
}

/** Exchanges a Google ID token for API tokens (the only way to sign in). */
export async function loginWithGoogle(apiUrl: string, idToken: string): Promise<Session> {
  apiUrl = normalise(apiUrl);
  const res = await fetch(`${apiUrl}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) {
    const problem = (await res.json().catch(() => undefined)) as { detail?: string } | undefined;
    throw new ApiError(res.status, problem?.detail);
  }
  const tokens = toSession({ apiUrl, email: '' }, await res.json());
  const authed = async <T>(p: string, init: RequestInit = {}): Promise<T> => {
    const r = await fetch(`${apiUrl}${p}`, {
      ...init,
      headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json' },
    });
    if (!r.ok) throw new ApiError(r.status, `Request failed (${r.status}).`);
    return (await r.json()) as T;
  };
  const me = await authed<{ email: string }>('/api/me');
  const device = await authed<{ id: string }>('/api/devices', {
    method: 'POST',
    body: JSON.stringify({ name: `${browserName()} extension`, platform: 'Browser' }),
  });
  const session: Session = { ...tokens, email: me.email, deviceId: device.id };
  await lastSeenItem.setValue(new Date().toISOString());
  await sessionItem.setValue(session);
  return session;
}

export async function logout() {
  await sessionItem.setValue(null);
  await lastSeenItem.setValue(null);
}

async function refresh(session: Session): Promise<Session | null> {
  const res = await fetch(`${session.apiUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });
  if (!res.ok) {
    await logout();
    return null;
  }
  const next = toSession(session, await res.json());
  await sessionItem.setValue(next);
  return next;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  let session = await sessionItem.getValue();
  if (!session) throw new ApiError(401);
  if (session.expiresAt - Date.now() < 30_000) {
    session = await refresh(session);
    if (!session) throw new ApiError(401);
  }

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${session.accessToken}`);
  if (init.body) headers.set('Content-Type', 'application/json');

  const res = await fetch(`${session.apiUrl}${path}`, { ...init, headers });
  if (res.status === 401 && retry && (await refresh(session))) return request<T>(path, init, false);
  if (!res.ok) {
    const problem = (await res.json().catch(() => undefined)) as { detail?: string; errors?: Record<string, string[]> } | undefined;
    throw new ApiError(res.status, problem?.detail ?? (problem?.errors ? Object.values(problem.errors).flat().join(' ') : undefined));
  }
  return res.status === 204 || res.status === 202 ? (undefined as T) : ((await res.json()) as T);
}

export const fetchMobileDevices = () => request<MobileDevice[]>('/api/devices')
  .then((devices) => devices.filter((device) => device.platform === 'Android'));

export const sendLinkToMobile = (deviceId: string, url: string, title: string) =>
  request<void>(`/api/devices/${encodeURIComponent(deviceId)}/links`, {
    method: 'POST',
    body: JSON.stringify({ url, title }),
  });

export const fetchNotifications = () =>
  request<NotificationPage>('/api/notifications?limit=20').then((p) => p.items);

export const dismissNotification = (id: string) =>
  request<void>(`/api/notifications/${id}/dismiss`, { method: 'POST' });

export async function setBadge(count: number) {
  const action = browser.action ?? browser.browserAction;
  await action.setBadgeText({ text: count > 0 ? String(Math.min(count, 99)) : '' });
  await action.setBadgeBackgroundColor({ color: '#2563eb' });
}
