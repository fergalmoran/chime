import { ExternalLink, Globe, Send, Smartphone, X } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState, ErrorText } from '@/components/popup/empty-state';
import {
  fetchMobileDevices,
  forgetPush,
  type MobileDevice,
  type PushedPage,
  pushHistoryItem,
  recordPush,
  sendLinkToMobile,
} from '@/lib/api';
import { currentPage } from '@/lib/current-page';
import { formatWhen, hostname } from '@/lib/format';

export function PushTab() {
  const [history, setHistory] = useState<PushedPage[]>([]);

  useEffect(() => {
    pushHistoryItem.getValue().then(setHistory);
    return pushHistoryItem.watch(setHistory);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <SendForm />
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Recently sent</h2>
        {history.length === 0 ? (
          <EmptyState icon={<Send />} title="Nothing sent yet">
            Pages you send to your phone from this browser will be listed here.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-1">
            {history.map((page) => (
              <li key={page.id} className="group flex items-center gap-1 rounded-lg hover:bg-accent hover:text-accent-foreground">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 p-2 text-left focus-visible:outline-2 focus-visible:outline-ring rounded-lg"
                  title={page.url}
                  onClick={() => void browser.tabs.create({ url: page.url })}
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                    <Globe className="size-4" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="truncate font-medium">{page.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {hostname(page.url)} · {page.deviceName} · {formatWhen(page.sentAt)}
                    </p>
                  </div>
                  <ExternalLink className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-muted-foreground"
                  aria-label="Remove from history"
                  onClick={() => void forgetPush(page.id)}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SendForm() {
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
      const device = devices?.find((d) => d.id === selectedId);
      await sendLinkToMobile(selectedId, page.url, page.title);
      await recordPush({ ...page, deviceId: selectedId, deviceName: device?.name ?? 'Phone' });
      setSent(`Sent to ${device?.name ?? 'your phone'}. Tap the notification there to open it.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send this page.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-linear-to-br from-primary/10 to-card p-3 text-card-foreground"
      onSubmit={send}
    >
      <div className="flex items-start gap-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Smartphone className="size-4" />
        </div>
        <div>
          <h2 className="font-semibold">Send to mobile</h2>
          <p className="text-xs text-muted-foreground">Send the current page as a notification on your phone.</p>
        </div>
      </div>
      {devices === null && !error && <p className="text-xs text-muted-foreground">Loading phones…</p>}
      {devices?.length === 0 && <p className="text-xs text-muted-foreground">Sign in to Chime on your Android phone first.</p>}
      {devices && devices.length > 0 && (
        <div className="flex gap-2">
          <Select
            value={selectedId}
            disabled={busy}
            onValueChange={(id) => {
              setSelectedId(id);
              setSent(null);
            }}
          >
            <SelectTrigger className="min-w-0 flex-1" aria-label="Phone">
              <SelectValue placeholder="Choose a phone" />
            </SelectTrigger>
            <SelectContent position="popper">
              {devices.map((device) => (
                <SelectItem key={device.id} value={device.id} disabled={!device.canReceiveLinks}>
                  {device.name}
                  {device.canReceiveLinks ? '' : ' (links off)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" disabled={busy || !selectedId}>
            <Send /> {busy ? 'Sending…' : 'Send'}
          </Button>
        </div>
      )}
      {devices?.some((device) => !device.canReceiveLinks) && (
        <p className="text-xs text-muted-foreground">
          To send to a phone marked "links off", open the Android app and enable Receive links from desktop.
        </p>
      )}
      {sent && (
        <p className="text-xs font-medium text-primary" role="status">
          {sent}
        </p>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </form>
  );
}
