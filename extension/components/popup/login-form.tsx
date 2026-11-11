import { type FormEvent, useState } from 'react';
import { browser } from 'wxt/browser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorText } from '@/components/popup/empty-state';
import { DEFAULT_API_URL, GOOGLE_CLIENT_ID } from '@/lib/api';
import type { GoogleLoginMessage, GoogleLoginReply } from '@/lib/google';

export function LoginForm() {
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
    <form className="flex flex-col gap-4 p-4" onSubmit={googleLogin}>
      <div>
        <h1 className="text-lg font-bold">Chime</h1>
        <p className="text-muted-foreground">Sign in with Google to see your phone's notifications.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="api-url">Server</Label>
        <Input id="api-url" type="url" required value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
      </div>
      {GOOGLE_CLIENT_ID ? (
        <Button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in with Google'}
        </Button>
      ) : (
        <ErrorText>Google sign-in isn't configured (set WXT_GOOGLE_CLIENT_ID).</ErrorText>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </form>
  );
}
