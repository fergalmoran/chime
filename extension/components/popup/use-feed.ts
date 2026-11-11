import { useCallback, useEffect, useState } from 'react';
import { dismissNotification, fetchNotifications, lastSeenItem, setBadge, type SyncedNotification } from '@/lib/api';

/** The undismissed notifications, refreshed whenever the background poller sees new ones. */
export function useFeed() {
  const [items, setItems] = useState<SyncedNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchNotifications()
      .then((next) => {
        setItems(next);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't load notifications."));
  }, []);

  useEffect(() => {
    load();
    return lastSeenItem.watch(load);
  }, [load]);

  const dismiss = useCallback(async (ids: string[]) => {
    const gone = new Set(ids);
    setItems((current) => current?.filter((n) => !gone.has(n.id)) ?? current);
    const results = await Promise.allSettled(ids.map(dismissNotification));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) {
      setError(failed.reason instanceof Error ? failed.reason.message : "Couldn't dismiss.");
      load();
      return;
    }
    const remaining = await fetchNotifications().catch(() => null);
    if (remaining) {
      setItems(remaining);
      await setBadge(remaining.length);
    }
  }, [load]);

  return { items, error, dismiss };
}
