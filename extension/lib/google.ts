import { browser } from 'wxt/browser';
import { GOOGLE_CLIENT_ID, loginWithGoogle } from '@/lib/api';

export interface GoogleLoginMessage {
  type: 'chime:google-login';
  apiUrl: string;
}

export type GoogleLoginReply = { ok: true } | { ok: false; error: string };

/** The URL Google redirects back to; it must be listed as an authorised redirect URI on the web client. */
export const googleRedirectUrl = () => browser.identity.getRedirectURL();

/**
 * Runs Google's OAuth implicit flow for an ID token, then signs in to the API.
 * Must run in the background: the popup closes as soon as the auth window takes focus.
 */
export async function signInWithGoogle(apiUrl: string) {
  if (!GOOGLE_CLIENT_ID) throw new Error('Google sign-in is not configured.');

  const nonce = crypto.randomUUID();
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.search = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    response_type: 'id_token',
    redirect_uri: googleRedirectUrl(),
    scope: 'openid email profile',
    nonce,
    prompt: 'select_account',
  }).toString();

  const redirect = await browser.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true });
  if (!redirect) throw new Error('Google sign-in was cancelled.');

  const params = new URLSearchParams(new URL(redirect).hash.slice(1));
  const idToken = params.get('id_token');
  if (!idToken) throw new Error(params.get('error') ?? 'Google did not return a credential.');
  if (readNonce(idToken) !== nonce) throw new Error('Google sign-in response could not be verified.');

  await loginWithGoogle(apiUrl, idToken);
}

function readNonce(jwt: string): string | undefined {
  try {
    const payload = (jwt.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
    return (JSON.parse(atob(payload)) as { nonce?: string }).nonce;
  } catch {
    return undefined;
  }
}
