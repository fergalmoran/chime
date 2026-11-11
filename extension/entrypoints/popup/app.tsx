import { LogOut } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { storage } from '#imports';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChimeLogo } from '@/components/popup/chime-logo';
import { ErrorText } from '@/components/popup/empty-state';
import { LoginForm } from '@/components/popup/login-form';
import { MessagesTab } from '@/components/popup/messages-tab';
import { NotificationsTab } from '@/components/popup/notifications-tab';
import { PushTab } from '@/components/popup/push-tab';
import { useFeed } from '@/components/popup/use-feed';
import { isMessage, logout, type Session, sessionItem } from '@/lib/api';

type PopupTab = 'pushing' | 'messages' | 'notifications';
const TABS: PopupTab[] = ['pushing', 'messages', 'notifications'];
/** The tab the popup reopens on. */
const tabItem = storage.defineItem<PopupTab>('local:popupTab', { fallback: 'notifications' });

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    sessionItem.getValue().then(setSession);
    return sessionItem.watch(setSession);
  }, []);

  if (session === undefined) return null;
  return session ? <SignedIn session={session} /> : <LoginForm />;
}

function SignedIn({ session }: { session: Session }) {
  const [tab, setTab] = useState<PopupTab | null>(null);
  const { items, error, dismiss } = useFeed();

  useEffect(() => {
    tabItem.getValue().then((saved) => setTab(TABS.includes(saved) ? saved : 'notifications'));
  }, []);

  const { messages, notifications } = useMemo(
    () => ({
      messages: items?.filter(isMessage) ?? [],
      notifications: items?.filter((n) => !isMessage(n)) ?? [],
    }),
    [items],
  );

  if (tab === null) return null;

  const feed = (content: ReactNode) => (
    <>
      {error && <ErrorText>{error}</ErrorText>}
      {items === null && !error ? <p className="py-6 text-center text-muted-foreground">Loading…</p> : content}
    </>
  );

  return (
    <div className="flex h-[560px] flex-col">
      <div className="h-1 shrink-0 bg-linear-to-r from-logo-arc-a via-primary to-logo-arc-b" />
      <header className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <ChimeLogo className="size-8 shrink-0" />
          <div className="min-w-0">
            <h1 className="bg-linear-to-r from-logo-arc-a to-logo-arc-b bg-clip-text text-lg leading-tight font-bold text-transparent">
              Chime
            </h1>
            <p className="truncate text-xs text-muted-foreground">{session.email}</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => void logout()}>
          <LogOut /> Log out
        </Button>
      </header>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as PopupTab);
          void tabItem.setValue(value as PopupTab);
        }}
        className="min-h-0 flex-1 gap-0"
      >
        <TabsList className={TAB_STRIP}>
          <TabsTrigger value="pushing" className={TAB}>
            Pushing
          </TabsTrigger>
          <TabsTrigger value="messages" className={TAB}>
            Messages <Count n={messages.length} />
          </TabsTrigger>
          <TabsTrigger value="notifications" className={TAB}>
            Notifications <Count n={notifications.length} />
          </TabsTrigger>
        </TabsList>
        <Panel value="pushing">
          <PushTab />
        </Panel>
        <Panel value="messages">{feed(<MessagesTab items={messages} onDismiss={dismiss} />)}</Panel>
        <Panel value="notifications">
          {feed(<NotificationsTab items={notifications} onDismiss={dismiss} />)}
        </Panel>
      </Tabs>
    </div>
  );
}

/** A muted strip whose bottom border the active tab breaks through, so it joins the panel below. */
const TAB_STRIP =
  'w-full items-end justify-start gap-1 rounded-none border-b bg-muted/60 px-3 pt-2 pb-0 group-data-[orientation=horizontal]/tabs:h-auto';

/** Folder-style tabs: inactive ones recede; the active one takes the panel colour and a brand-coloured top edge. */
const TAB = [
  'h-auto flex-auto -mb-px rounded-b-none rounded-t-lg border border-transparent px-2 py-2',
  'text-muted-foreground hover:bg-background/60 hover:text-foreground',
  'data-[state=active]:border-border data-[state=active]:border-b-background data-[state=active]:bg-background data-[state=active]:text-primary',
  'dark:data-[state=active]:border-border dark:data-[state=active]:border-b-background dark:data-[state=active]:bg-background dark:data-[state=active]:text-primary',
  'group-data-[variant=default]/tabs-list:data-[state=active]:shadow-[inset_0_2px_0_var(--primary)]',
].join(' ');

function Panel({ value, children }: { value: PopupTab; children: ReactNode }) {
  return (
    <TabsContent value={value} className="min-h-0 flex-1">
      <ScrollArea className="h-full">
        <div className="p-4">{children}</div>
      </ScrollArea>
    </TabsContent>
  );
}

function Count({ n }: { n: number }) {
  if (n === 0) return null;
  return (
    <span className="rounded-full bg-primary px-1.5 text-[11px] leading-4 font-semibold text-primary-foreground">
      {n > 99 ? '99+' : n}
    </span>
  );
}
