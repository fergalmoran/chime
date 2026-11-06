import { browser } from 'wxt/browser';
import { fetchNotifications, GOOGLE_CLIENT_ID, lastSeenItem, sessionItem, setBadge } from '@/lib/api';
import { type GoogleLoginMessage, type GoogleLoginReply, googleRedirectUrl, signInWithGoogle } from '@/lib/google';

const POLL_ALARM = 'chime-poll';
let polling = false;

export default defineBackground(() => {
  browser.alarms.create(POLL_ALARM, { periodInMinutes: 1 });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === POLL_ALARM) void poll();
  });

  // Poll immediately after login, and clear the badge on logout.
  sessionItem.watch((session) => {
    if (session) void poll();
    else void setBadge(0);
  });

  browser.runtime.onMessage.addListener((message: GoogleLoginMessage, _sender, sendResponse) => {
    if (message?.type !== 'chime:google-login') return;
    signInWithGoogle(message.apiUrl)
      .then(() => sendResponse({ ok: true } satisfies GoogleLoginReply))
      .catch((err: unknown) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : 'Google sign-in failed.' } satisfies GoogleLoginReply),
      );
    return true;
  });

  if (GOOGLE_CLIENT_ID) console.info('Chime Google redirect URI:', googleRedirectUrl());

  void poll();
});

/** Fetches the latest notifications, updates the badge and raises desktop alerts for new ones. */
async function poll() {
  if (polling) return;
  polling = true;
  try {
    if (!(await sessionItem.getValue())) return;
    const pollStartedAt = new Date().toISOString();
    const items = await fetchNotifications();
    await setBadge(items.length);

    const lastSeen = await lastSeenItem.getValue();
    const fresh = lastSeen ? items.filter((n) => Date.parse(n.receivedAt) > Date.parse(lastSeen)) : [];
    for (const n of fresh.toReversed()) {
      await browser.notifications.create(n.id, {
        type: 'basic',
        iconUrl: browser.runtime.getURL('/icon/128.png'),
        title: n.title ?? n.appName ?? n.appId,
        message: n.body ?? n.appName ?? '',
      });
    }
    // Establish a baseline even for an empty feed, so its first arrival isn't skipped.
    const newest = items[0]?.receivedAt;
    await lastSeenItem.setValue(
      newest && (!lastSeen || Date.parse(newest) > Date.parse(lastSeen))
        ? newest
        : lastSeen ?? pollStartedAt,
    );
  } catch (err) {
    console.warn('Chime poll failed', err);
  } finally {
    polling = false;
  }
}
