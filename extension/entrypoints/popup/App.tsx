import { type FormEvent, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  DEFAULT_API_URL,
  GOOGLE_CLIENT_ID,
  dismissNotification,
  fetchNotifications,
  fetchMobileDevices,
  type MobileDevice,
  logout,
  type Session,
  sessionItem,
  setBadge,
  sendLinkToMobile,
  type SyncedNotification,
} from '@/lib/api';
import type { GoogleLoginMessage, GoogleLoginReply } from '@/lib/google';
import { currentPage } from '@/lib/current-page';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    sessionItem.getValue().then(setSession);
    return sessionItem.watch(setSession);
  }, []);

  if (session === undefined) return null;
  return session ? <Feed session={session} /> : <LoginForm />;
}

function LoginForm() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const googleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // On success the popup re-renders via the session watcher (if it's still open).
      const reply = (await browser.runtime.sendMessage({
        type: 'chime:google-login',
        apiUrl,
      } satisfies GoogleLoginMessage)) as GoogleLoginReply;
      if (!reply.ok) setError(reply.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel" onSubmit={googleLogin}>
      <h1>Chime</h1>
      <p className="muted">Sign in with Google to see your phone's notifications.</p>
      <label>
        Server
        <input type="url" required value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
      </label>
      {GOOGLE_CLIENT_ID ? (
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in with Google'}
        </button>
      ) : (
        <p className="error">Google sign-in isn't configured (set WXT_GOOGLE_CLIENT_ID).</p>
      )}
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function Feed({ session }: { session: Session }) {
  const [items, setItems] = useState<SyncedNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchNotifications()
      .then(setItems)
      .catch((err) => setError(err.message));
  }, []);

  const dismiss = async (id: string) => {
    await dismissNotification(id);
    const next = (items ?? []).filter((n) => n.id !== id);
    setItems(next);
    await setBadge(next.length);
  };

  return (
    <div className="panel">
      <header>
        <h1>Chime</h1>
        <button type="button" className="link" onClick={() => logout()} title={session.email}>
          Log out
        </button>
      </header>
      <SendToMobile />
      {error && <p className="error">{error}</p>}
      {items === null && !error && <p className="muted">Loading…</p>}
      {items?.length === 0 && <p className="muted">You're all caught up.</p>}
      <ul>
        {items?.map((n) => (
          <li key={n.id}>
            <div>
              <small className="muted">
                {n.appName ?? n.appId} · {new Date(n.postedAt).toLocaleTimeString([], { timeStyle: 'short' })}
              </small>
              {n.title && <strong>{n.title}</strong>}
              {n.body && <p>{n.body}</p>}
            </div>
            <button type="button" className="link" aria-label="Dismiss" onClick={() => dismiss(n.id)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SendToMobile() {
  const [devices, setDevices] = useState<MobileDevice[] | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchMobileDevices()
      .then((phones) => {
        setDevices(phones);
        setSelectedId(phones.find((phone) => phone.canReceiveLinks)?.id ?? '');
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't load phones."));
  }, []);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const page = await currentPage();
      await sendLinkToMobile(selectedId, page.url, page.title);
      setSent(`Sent to ${devices?.find((device) => device.id === selectedId)?.name ?? 'phone'}. Tap the notification there to open it.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send this page.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="send-to-mobile" onSubmit={send}>
      <h2>Send to mobile</h2>
      <p className="muted">Send the current page as a notification on your phone.</p>
      {devices === null && !error && <p className="muted">Loading phones…</p>}
      {devices?.length === 0 && <p className="muted">Sign in to Chime on your Android phone first.</p>}
      {devices && devices.length > 0 && (
        <label>
          Phone
          <select value={selectedId} disabled={busy} onChange={(e) => { setSelectedId(e.target.value); setSent(null); }}>
            <option value="" disabled>Choose a phone</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id} disabled={!device.canReceiveLinks}>
                {device.name}{device.canReceiveLinks ? '' : ' — enable mobile notifications first'}
              </option>
            ))}
          </select>
        </label>
      )}
      {devices?.some((device) => !device.canReceiveLinks) && (
        <p className="muted">Open the updated Android app and enable Receive links from desktop.</p>
      )}
      <button type="submit" disabled={busy || !selectedId}>{busy ? 'Sending…' : 'Send current page'}</button>
      {sent && <p role="status">{sent}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
