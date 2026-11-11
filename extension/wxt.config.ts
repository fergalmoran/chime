import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  // WXT defaults to 3000, which clashes with the web app's dev server.
  webExt: { disabled: true },
  dev: { server: { port: 3010 } },
  manifest: ({ browser }) => ({
    name: 'Chime',
    description: 'See your phone notifications in your browser.',
    permissions: ['storage', 'alarms', 'notifications', 'identity', 'activeTab'],
    action: { default_title: 'Chime' },
    // Pin the extension ID so the Google OAuth redirect URI stays stable.
    // Chrome derives the ID from this public key (see README). The Chrome Web
    // Store rejects uploads whose manifest has a `key`, so `bun run zip` sets
    // CHIME_STORE_BUILD to leave it out; the store assigns the ID itself.
    ...(browser !== 'firefox' && !process.env.CHIME_STORE_BUILD && process.env.WXT_CHROME_EXTENSION_KEY
      ? { key: process.env.WXT_CHROME_EXTENSION_KEY }
      : {}),
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'chime@podnoms.com',
              // Required by AMO. Declares what the extension transmits off-device:
              // the Google sign-in token and account email, and (when the user
              // sends a page to their phone) the active tab's URL and title.
              data_collection_permissions: {
                required: [
                  'authenticationInfo',
                  'personallyIdentifyingInfo',
                  'browsingActivity',
                  'websiteContent',
                ],
              },
            },
          },
        }
      : {}),
  }),
});
