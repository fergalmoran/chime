# Chime

[![API](https://github.com/fergalmoran/chime/actions/workflows/api.yml/badge.svg?branch=trunk)](https://github.com/fergalmoran/chime/actions/workflows/api.yml?query=branch%3Atrunk)
[![Web](https://github.com/fergalmoran/chime/actions/workflows/web.yml/badge.svg?branch=trunk)](https://github.com/fergalmoran/chime/actions/workflows/web.yml?query=branch%3Atrunk)
[![Android](https://github.com/fergalmoran/chime/actions/workflows/android.yml/badge.svg)](https://github.com/fergalmoran/chime/actions/workflows/android.yml)
[![Android release](https://img.shields.io/github/v/release/fergalmoran/chime?filter=android-v*&label=android&sort=semver)](https://github.com/fergalmoran/chime/releases)

Sync notifications from your Android phone to your desktop.

```
┌──────────────┐  POST /api/notifications  ┌────────────────┐  SignalR / polling  ┌──────────────────┐
│ Android app  │ ────────────────────────▶ │  .NET API      │ ──────────────────▶ │ Web app          │
│ (listener)   │                           │  (auth, data)  │                     │ Browser extension│
└──────────────┘                           └────────────────┘                     └──────────────────┘
```

| Folder | What | Stack |
| --- | --- | --- |
| [`api/`](api) | The brains: auth, devices, notifications, settings, real-time push | ASP.NET Core 10 minimal APIs, Identity bearer tokens, EF Core + SQLite, SignalR, xUnit |
| [`web/`](web) | Marketing site + dashboard (notifications feed, devices, settings) | TanStack Start, TanStack Query, Tailwind v4, shadcn/ui, Biome |
| [`android/`](android) | Listens for notifications (WhatsApp, SMS, email, …) and forwards them to the API | Kotlin, Jetpack Compose (Material 3), `NotificationListenerService`, WorkManager, DataStore, Ktor |
| [`extension/`](extension) | Toolbar icon with a popup feed, badge count and desktop alerts | WXT, React (Chrome MV3 / Firefox MV2) |

## Quick start

Prerequisites: .NET 10 SDK, Bun, JDK 21 + Android SDK (API 37).

```bash
# 1. API → https://chime.dev.fergl.ie:5002 (creates/migrates chime.db in Development)
cd api && dotnet run --project src/api

# 2. Web → http://localhost:3000  (copy .env.example to .env to point at another API)
cd web && bun install && bun run dev

# 3. Extension → opens a browser with the extension loaded
cd extension && bun install && bun run dev        # or: bun run dev:firefox

# 4. Android
cd android && ./gradlew installDebug
```

Sign in with your Google account on the website, Android app and extension (the first sign-in creates your account).
After signing in on Android, tap **Grant access** to enable notification access.

## Google sign-in

Google is the **only** way to sign in; there are no username/password endpoints. Every client gets a Google
**ID token** and exchanges it at `POST /api/auth/google` for bearer/refresh tokens. The first sign-in creates an account,
or links to an existing account with the same (verified) email. Each client needs its Google client ID configured
(below) or it shows a "not configured" message instead of the sign-in button.

In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) create OAuth client IDs:

1. **Web application** client (used by the API, web, extension *and* Android):
   - Authorised JavaScript origins: `http://localhost:3000` (plus your production web origin)
   - Authorised redirect URIs: the web app's `<origin>/auth/callback` for each web origin (e.g.
     `https://chime.dev.fergl.ie:3000/auth/callback`, `https://chime.ferg.al/auth/callback`), plus the
     extension's redirect URL. The background script logs it on startup as
     `Chime Google redirect URI: https://<extension-id>.chromiumapp.org/` (Firefox: `…extensions.allizom.org/`).
     Pin the extension ID or the URL changes between installs:
     - Firefox: pinned via `browser_specific_settings.gecko.id` (`chime@podnoms.com`) in `wxt.config.ts`,
       giving `https://b3a7f9a99c0599ff684f979fa3b226eec9e47c1f.extensions.allizom.org/`.
     - Chrome: generate a key and put its base64 public key in `extension/.env` as `WXT_CHROME_EXTENSION_KEY`:
       ```sh
       openssl genrsa -out key.pem 2048
       openssl rsa -in key.pem -pubout -outform DER | base64 -w0          # → WXT_CHROME_EXTENSION_KEY
       openssl rsa -in key.pem -pubout -outform DER | sha256sum | head -c32 | tr 0-9a-f a-p   # → extension ID
       ```
       Redirect URI is then `https://<extension-id>.chromiumapp.org/`. Once published, use the public key
       shown in the Chrome Web Store dashboard instead so dev and store builds share the ID.
       The store rejects a manifest containing `key`, so `bun run zip` builds without it.
2. **Android** client: package `com.podnoms.chime` + SHA-1 of your signing key
   (`keytool -list -v -keystore ~/.android/debug.keystore -storepass android` for debug builds).
   Nothing needs to be configured in the app for this client; Google matches it by package + signature.

Then set the **web** client ID in each place:

| Part | Setting |
| --- | --- |
| API | `Authentication:Google:ClientIds` in `appsettings*.json` (array of accepted audiences), or env `Authentication__Google__ClientIds__0` |
| Web | `VITE_GOOGLE_CLIENT_ID` in `web/.env` |
| Extension | `WXT_GOOGLE_CLIENT_ID` in `extension/.env` |
| Android | `chime.googleWebClientId=…` in `~/.gradle/gradle.properties` (or `-Pchime.googleWebClientId=…`) |

Until it's set, the API returns `501` from `/api/auth/google` and the clients show a "not configured" message instead of the sign-in button.

## Send a web page to your phone

The extension's **Send to mobile** panel sends the active HTTP/HTTPS tab to a selected Android phone.
Android shows a notification containing the page title and URL; tapping it opens the page in the phone's
browser. This uses Firebase Cloud Messaging (FCM), so the Android app doesn't need to stay open.

### One-time Firebase setup

1. In [Firebase Console](https://console.firebase.google.com/), add Firebase to your existing Google Cloud
   project (the one used for Google sign-in). Google Analytics is optional.
2. Add an **Android** app with package `com.podnoms.chime`. Download its `google-services.json` and place it
   at `android/app/google-services.json` (gitignored). The Gradle Google Services plugin runs only when this
   file exists; builds without it still support Google sign-in and notification upload.
3. Ensure **Firebase Cloud Messaging API (HTTP v1)** is enabled in that project's Google Cloud APIs.
4. Give the API's service account the **Firebase Cloud Messaging API Admin** role on that project.
   In Google Cloud, open **IAM & Admin > Service Accounts**, create/select the account and assign that role.
   Use its **Keys > Add key > Create new key > JSON** action, keep the downloaded file outside the repository,
   and set **`Firebase:CredentialsFilePath`** in the **.NET API (`Chime.Api`) configuration** to its location.
   No environment variable is required. See the development/production examples below.
5. Set `Firebase:ProjectId` in the API configuration. The Android Firebase project and API project must match. This is separate from the Google
   OAuth client ID; keep your existing Google sign-in settings.
6. Restart the API. Development applies the included `DevicePushToken` migration automatically. For other
   environments apply migrations explicitly: `cd api && dotnet ef database update -p src/api`.
7. Rebuild/install the Android app, sign in, and enable **Receive links from desktop** / **Enable mobile
   notifications**. Wait until it says the phone is ready. This needs Google Play services and permission
   to show notifications; notification-listener access alone does not grant that permission.
8. Rebuild/reload the extension (it now requests `activeTab`), open a normal web page, click Chime, choose
   your phone and click **Send current page**.

The API only accepts sends to the signed-in user's phones. It returns `202` when FCM accepts the message,
not a delivery receipt. FCM queues offline delivery for up to 24 hours; notification settings, a force-stopped
Android app, or unavailable Play services can prevent display. Signed-out apps discard incoming links.
FCM installation IDs (the current SDK's registration mechanism) aren't exposed in device responses.
Without Firebase configuration the app explains what's
missing and the API rejects sends rather than claiming success.

### API credentials: development and production

Both environments can use the same **.NET configuration keys**, without environment variables.
For example, set this section in the API's `appsettings.Development.json`:

```json
{
  "Firebase": {
    "ProjectId": "your-firebase-project-id",
    "CredentialsFilePath": "/home/you/.config/chime/api-firebase.json"
  }
}
```

Only the path belongs in appsettings, **never the contents of the private-key file**. An absolute path is
unambiguous; relative paths resolve from the API content root (normally `api/src/api`), not the
solution/workspace root. Thus `"CredentialsFilePath": "api-firebase.json"` looks beside the API's appsettings.
The filename `api-firebase.json` is gitignored as an extra safeguard.

Alternatively, store the path in .NET user-secrets (the API already has a `UserSecretsId`):

```sh
cd api
dotnet user-secrets set "Firebase:CredentialsFilePath" "/absolute/path/to/api-firebase.json" \
  --project src/api
```

User-secrets load automatically in Development. In production, mount the credential as a read-only secret
inside the **API container only**, and set `Firebase:CredentialsFilePath` in its deployed .NET configuration
to that container path, e.g. `/run/secrets/api-firebase.json`. Do not bake the key into the image. Use separate,
least-privilege service accounts for development and production. Restart the API after configuration changes.

`Firebase:CredentialsJson` is still supported as an alternative for .NET secret providers that supply the
complete JSON directly. Configure **one** explicit credential source, not both. Invalid or unreadable
configured credentials produce an explicit configuration error rather than falling back to another identity.

If neither setting is present, the API uses Google's Application Default Credentials (ADC), allowing keyless
workload identity where supported. `GOOGLE_APPLICATION_CREDENTIALS` remains an optional ADC mechanism, not a
requirement for the .NET-configured file path.

## Instant delivery to the browser extension

The extension refreshes as soon as the feed changes, instead of waiting for its poll:

- **Chrome** (MV3 service worker) subscribes to **Web Push**. The API sends a content-free "feed changed"
  signal to each subscribed browser when a notification arrives or is dismissed; the extension then fetches its
  feed, so notification content never passes through the push service.
- **Firefox** extensions can't use Web Push yet ([bug 1378096](https://bugzilla.mozilla.org/show_bug.cgi?id=1378096)),
  so the Firefox build is MV2 with a persistent background page that holds a SignalR connection to
  `/api/hubs/notifications`.

Both keep polling as a safety net: every minute when no live channel is up, every 15 minutes when one is.

Web Push needs a VAPID key pair in the API configuration (`WebPush:PublicKey`, `WebPush:PrivateKey`, both
base64url). Without it, `GET /api/web-push/key` returns `404` and Chrome falls back to polling.
`scripts/generate-vapid-keys.sh` generates a pair (needs `openssl`). Use a separate pair for each environment.

**Production:** the script prints the pair as environment variables for the API container:

```sh
scripts/generate-vapid-keys.sh
# WebPush__PublicKey=BHzQ…
# WebPush__PrivateKey=x8Kd…
```

Add both lines to the API container's environment (e.g. the `env_file` or `environment:` of its compose service,
or a secret store), then restart it. Redirect straight into a file to keep the private key out of your terminal
scrollback: `scripts/generate-vapid-keys.sh >> chime-api.env` (keep that file out of git). Check it's live with
an authenticated `GET /api/web-push/key`, which returns the public key instead of `404`.

**Development:** `scripts/generate-vapid-keys.sh --user-secrets` stores the pair in the API's user-secrets.

Changing a deployed pair makes existing subscriptions fail until each extension re-checks with the API (at most
a day later). `WebPush:Subject` (default `https://chime.ferg.al`) is the contact URL sent to push services.

## API overview

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/google` | Exchange a Google ID token for bearer/refresh tokens (only sign-in method) |
| `POST /api/auth/refresh` | Exchange a refresh token for new tokens |
| `GET /api/me` | Current user |
| `DELETE /api/account` | Permanently delete the account and all its data; outstanding tokens stop working immediately |
| `GET/POST /api/devices`, `DELETE /api/devices/{id}` | Registered phones / browsers |
| `PUT /api/devices/{id}/push-token` | Android registers an FCM token (`{"token":null}` unregisters it) |
| `GET /api/web-push/key` | VAPID public key for browser Web Push (`404` when not configured) |
| `PUT/DELETE /api/devices/{id}/web-push` | A browser extension saves (`{"endpoint","p256dh","auth"}`) or removes its Web Push subscription |
| `POST /api/devices/{id}/links` | Send `{"url":"https://…","title":"…"}` to an owned Android phone via FCM |
| `GET /api/notifications?before=&limit=&includeDismissed=` | Paged feed (newest first) |
| `POST /api/notifications` | Called by the phone. `201` stored, `200` duplicate (`externalKey`), `204` filtered by settings |
| `POST /api/notifications/{id}/dismiss`, `DELETE /api/notifications/{id}` | Dismiss / delete |
| `GET/PUT /api/settings` | Sync on/off, categories, muted apps, hide bodies, retention |
| `/api/hubs/notifications` (SignalR) | Pushes `NotificationReceived` / `NotificationDismissed` to the signed-in user |

The OpenAPI document is at `/openapi/v1.json` in Development. A background service purges notifications older
than each user's retention period. `GET /api/health` is an unauthenticated liveness check.

Every route lives under `/api`, so in production one origin serves both: `https://chime.ferg.al/api/*` goes to
the API and everything else to the web app. Clients use the origin as their API URL and append the paths above.

## Docker

The API and web app each build an image (amd64), published to GHCR by GitHub Actions
(`.github/workflows/api.yml`, `web.yml`). Pull requests build without publishing; pushes to `trunk` publish
`latest` and a commit-SHA tag; `v*` tags also publish version tags.

| Image | Listens on | Notes |
| --- | --- | --- |
| `ghcr.io/fergalmoran/chime-api` | `8080` | Mount a volume at **`/data`**: it holds the SQLite database and the Data Protection key ring (without it, every restart signs everyone out). Migrations run on startup. Set `Authentication__Google__ClientIds__0`, `Firebase__ProjectId` (defaults from `appsettings.json`) and `Firebase__CredentialsFilePath` (mount the service-account key, e.g. as a secret). Set `WebPush__PublicKey` and `WebPush__PrivateKey` for instant delivery to Chrome (see above). Forwarded headers are trusted, for running behind Traefik. |
| `ghcr.io/fergalmoran/chime-web` | `3000` | `VITE_API_URL` (default `https://chime.ferg.al`) and `VITE_GOOGLE_CLIENT_ID` are compiled in: build args, overridable via repository variables of the same name. |

Build and run locally:

```bash
docker build -t chime-api api && docker run --rm -p 8080:8080 -v chime-data:/data \
  -e Cors__AllowedOrigins__0=http://localhost:3000 chime-api   # cross-origin locally; same origin in production
docker build -t chime-web --build-arg VITE_API_URL=http://localhost:8080 web && docker run --rm -p 3000:3000 chime-web
```

## Development notes

- **Production web server:** `cd web && bun run build && bun server.js` (what the image runs; `PORT`, default 3000).
- **Tests:** `cd api && dotnet test` · `cd android && ./gradlew testDebugUnitTest lintDebug` ·
  `cd web && bun test && bun run check && bunx tsc --noEmit` · `cd extension && bun test && bun run compile`
- **Migrations:** `cd api && dotnet ef migrations add <Name> -p src/api -o Data/Migrations`
- **Dev API URL:** every client defaults to `https://chime.dev.fergl.ie:5002` (Kestrel endpoint in
  `appsettings.Development.json`). Override with `VITE_API_URL` (web), the API URL field (extension/Android), or
  `DEFAULT_API_URL` in `android/app/build.gradle.kts`. Debug Android builds still allow cleartext HTTP for LAN testing.
- **Android 13+ sideloading:** if the notification-access toggle is greyed out, open the app's system info page,
  then ⋮ → *Allow restricted settings*.
- **Delivery:** the phone uploads immediately, falling back to WorkManager (network-constrained, exponential
  backoff) when offline. Uploads carry an `externalKey` so retries never create duplicates.
- **CORS:** `Cors:AllowedOrigins` in `appsettings*.json` plus any `chrome-extension://` / `moz-extension://` origin.
  Development allows `https://chime.dev.fergl.ie:3000`. Origins must contain only scheme, host and port:
  no trailing slash or path. Restart the API after changing the allowlist.
- **Extension:** the MV3 service worker can't hold a socket open, so it polls every minute via `alarms`, updates
  the badge and raises desktop notifications for new items.
- **Desktop alerts:** click **Enable desktop notifications** in the web dashboard and allow the browser's
  permission prompt for immediate OS notifications while any dashboard tab is open. For alerts with the
  dashboard closed, install and sign in to the extension (polls approximately once a minute while the browser
  is running). Enable only one channel to avoid duplicate alerts. Browser/OS notification settings and Do Not
  Disturb can suppress banners; check those if notifications are allowed but no banner appears.

## Next steps

- Postgres (or similar) for production, plus HTTPS and a real deployment
- More phone actions over FCM (e.g. reply/dismiss on the phone)
- Live SignalR feed in the extension popup, per-app icons, quick replies

## License

Copyright 2026 Fergal Moran

Licensed under the [Apache License, Version 2.0](LICENSE).
