import { BellOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/popup/empty-state';
import type { SyncedNotification } from '@/lib/api';
import { formatWhen } from '@/lib/format';
import { tintFor } from '@/lib/tint';
import { cn } from 'cn';

export function NotificationsTab({
  items,
  onDismiss,
}: {
  items: SyncedNotification[];
  onDismiss: (ids: string[]) => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyState icon={<BellOff />} title="You're all caught up">
        New notifications from your phone will show up here.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {items.length} notification{items.length === 1 ? '' : 's'}
        </p>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onDismiss(items.map((n) => n.id))}>
          Clear all
        </Button>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((n) => (
          <li
            key={n.id}
            className={cn(
              'group flex items-start gap-2 rounded-lg border border-l-4 bg-card p-3 text-card-foreground',
              tintFor(n.appId).edge,
            )}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn('size-2 shrink-0 rounded-full', tintFor(n.appId).dot)} />
                <span className="font-medium text-foreground">{n.appName ?? n.appId}</span> · {formatWhen(n.postedAt)}
              </p>
              {n.title && <p className="font-semibold leading-snug">{n.title}</p>}
              {n.body && <p className="line-clamp-4 leading-snug break-words [overflow-wrap:anywhere]">{n.body}</p>}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-muted-foreground"
              aria-label="Dismiss"
              onClick={() => onDismiss([n.id])}
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
