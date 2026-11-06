import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // WXT defaults to 3000, which clashes with the web app's dev server.
  webExt: { disabled: true },
  dev: { server: { port: 3010 } },
  manifest: ({ browser }) => ({
    name: 'Chime',
    description: 'See your phone notifications in your browser.',
    permissions: ['storage', 'alarms', 'notifications', 'identity', 'activeTab'],
    action: { default_title: 'Chime' },
    // Pin the extension ID so the Google OAuth redirect URI stays stable.
    // Chrome derives the ID from this public key (see README).
    ...(browser !== 'firefox' && process.env.WXT_CHROME_EXTENSION_KEY
      ? { key: process.env.WXT_CHROME_EXTENSION_KEY }
      : {}),
    ...(browser === 'firefox'
      ? { browser_specific_settings: { gecko: { id: 'chime@podnoms.com' } } }
      : {}),
  }),
});
