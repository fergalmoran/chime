import { ArrowLeft, Check, MessagesSquare } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/popup/empty-state';
import type { SyncedNotification } from '@/lib/api';
import { type Conversation, groupConversations } from '@/lib/conversations';
import { formatWhen } from '@/lib/format';
import { tintFor } from '@/lib/tint';
import { cn } from 'cn';

export function MessagesTab({
  items,
  onDismiss,
}: {
  items: SyncedNotification[];
  onDismiss: (ids: string[]) => void;
}) {
  const conversations = useMemo(() => groupConversations(items), [items]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = conversations.find((c) => c.key === openKey);

  if (open) {
    return (
      <Thread
        conversation={open}
        onBack={() => setOpenKey(null)}
        onDismiss={() => {
          setOpenKey(null);
          onDismiss(open.messages.map((m) => m.id));
        }}
      />
    );
  }

  if (conversations.length === 0) {
    return (
      <EmptyState icon={<MessagesSquare />} title="No new messages">
        Texts and chat messages your phone receives will show up here, grouped by conversation.
      </EmptyState>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {conversations.map((c) => {
        const last = c.messages.at(-1);
        return (
          <li key={c.key}>
            <button
              type="button"
              onClick={() => setOpenKey(c.key)}
              className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Avatar name={c.name} />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate font-semibold">{c.name}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatWhen(c.lastPostedAt)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-muted-foreground">
                    {last?.sender ? `${last.sender}: ` : ''}
                    {last?.text}
                  </p>
                  {c.messages.length > 1 && (
                    <span className="shrink-0 rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
                      {c.messages.length}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{c.appName}</p>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Thread({ conversation, onBack, onDismiss }: { conversation: Conversation; onBack: () => void; onDismiss: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="size-8" aria-label="Back to conversations" onClick={onBack}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{conversation.name}</p>
          <p className="text-xs text-muted-foreground">{conversation.appName}</p>
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={onDismiss}>
          <Check /> Clear
        </Button>
      </div>
      <ul className="flex flex-col gap-2">
        {conversation.messages.map((m) => (
          <li key={m.id} className="flex flex-col items-start gap-0.5">
            {m.sender && <span className="px-1 text-xs font-medium text-muted-foreground">{m.sender}</span>}
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-accent px-3 text-accent-foreground py-2 leading-snug break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
              {m.text}
            </div>
            <span className="px-1 text-[11px] text-muted-foreground">{formatWhen(m.postedAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');
  return (
    <div
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-foreground ring-1',
        tintFor(name).avatar,
      )}
    >
      {initials || '?'}
    </div>
  );
}
