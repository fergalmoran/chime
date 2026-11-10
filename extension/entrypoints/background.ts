import { browser } from 'wxt/browser';
import { fetchNotifications, GOOGLE_CLIENT_ID, lastSeenItem, sessionItem, setBadge } from '@/lib/api';
import { type GoogleLoginMessage, type GoogleLoginReply, googleRedirectUrl, signInWithGoogle } from '@/lib/google';
import { createRealtime } from '@/lib/realtime';

const POLL_ALARM = 'chime-poll';
/** Poll interval while nothing pushes changes to us. */
const POLL_MINUTES = 1;
/** Safety-net interval while a live channel is up, in case a signal is lost. */
const BACKUP_POLL_MINUTES = 15;

let polling: Promise<void> | undefined;
let pollAgain = false;

export default defineBackground({
  // Firefox (MV2) keeps the page alive so it can hold the live connection; Chrome's MV3 worker uses Web Push.
  persistent: { firefox: true },
  main() {
    const realtime = createRealtime({
      onChange: poll,
      onStatus: (live) => void setPollInterval(live ? BACKUP_POLL_MINUTES : POLL_MINUTES),
    });

    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === POLL_ALARM) void poll();
    });

    // Refresh and go live after login; tear down and clear the badge on logout.
    sessionItem.watch((session) => {
      if (session) {
        void poll();
        void realtime.start();
      } else {
        void realtime.stop();
        void setBadge(0);
      }
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

    void ensurePollAlarm();
    void poll();
    void realtime.start();
  },
});

/** Creates the poll alarm if it's missing, keeping any existing schedule (the MV3 worker restarts often). */
async function ensurePollAlarm() {
  if (!(await browser.alarms.get(POLL_ALARM))) browser.alarms.create(POLL_ALARM, { periodInMinutes: POLL_MINUTES });
}

async function setPollInterval(minutes: number) {
  const alarm = await browser.alarms.get(POLL_ALARM);
  if (alarm?.periodInMinutes !== minutes) browser.alarms.create(POLL_ALARM, { periodInMinutes: minutes });
}

/**
 * Fetches the latest notifications, updates the badge and raises desktop alerts for new ones. A call made while
 * a poll is running schedules one more run, so a change signalled mid-poll is never missed.
 */
function poll(): Promise<void> {
  if (polling) {
    pollAgain = true;
    return polling;
  }
  polling = (async () => {
    try {
      do {
        pollAgain = false;
        await pollOnce();
      } while (pollAgain);
    } finally {
      polling = undefined;
    }
  })();
  return polling;
}

async function pollOnce() {
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
  }
}
