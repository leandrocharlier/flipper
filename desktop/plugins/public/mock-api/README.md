# Mock API

Local mock servers powered by **Mockoon commons-server 9.9.0**. Select your
computer (Windows, macOS or Linux) in Flipper's device selector, then **Mock API**.
In an existing Flipper profile, enable it from the Disabled plugins section if needed.
This plugin needs no Flipper SDK in the Android, iOS or React Native app.
It is an independent integration, not the Mockoon desktop application or Cloud.

## Environments and playback

- Create an environment or import one or several Mockoon JSON files at once.
  A JSON array of environments is supported too. The single **Import** action
  detects Mockoon or OpenAPI JSON/YAML automatically. Existing ports are preserved;
  new environments default to **3000**.
- Change the port directly in the address above the tabs, or in **Settings → Port**.
  Save and reload a running server to apply the new port. Update the app's base URL
  and any `adb reverse` port mapping to match.
- Press **Start** / **Stop** for each environment. Several can run concurrently
  on different ports; an occupied port produces an error, never an automatic change.
- Edit routes, responses, headers, request rules, delays, proxy and TLS settings.
  **Save** persists the draft locally. A running server keeps its previous
  configuration until you press the **reload arrow**.
- In the native desktop app, imported files are watched. External edits update
  the configuration and mark a running server for reload. Invalid edits retain
  the last valid configuration and display an error. Source files are never
  overwritten; editing in Flipper saves a separate local copy. Detach a source
  in Settings to stop watching it. Browser imports cannot provide a local path;
  import again to load external changes.
- Export saved environments as Mockoon JSON or OpenAPI. OpenAPI cannot represent
  all Mockoon features. Set the working directory for relative response/certificate
  paths; native file imports select the source directory automatically.

## Engine capabilities

HTTP, multiple responses, rules, sequential/random selection, Handlebars/Faker
templates, response files, proxying, CRUD/data buckets, callbacks and WebSocket
routes use the actual Mockoon engine. Data buckets, callbacks and advanced
configuration currently use JSON editors; this is not a copy of every Mockoon
visual editor. Click **Apply JSON to draft**, then **Save**. Unknown future
environment schemas are rejected; supported older formats are migrated in memory.

## HTTPS

Enable **TLS / HTTPS** and choose PEM certificate/key or PFX, optional CA and
passphrase. Paths can be absolute or relative to the working directory. Empty
paths use Mockoon's public development certificate. Clients must trust the chosen
certificate; Android debug network-security configuration may be necessary.
The built-in certificate is for local development only.

The Android sample has ready-to-test HTTP and HTTPS buttons. See the
[sample setup](../../../../android/BUILDING-16KB.md#local-mock-api-buttons-debug-sample)
for generating two local environments and a certificate with Android-compatible
subject alternative names.

TLS passphrases and admin API tokens remain in memory for the current session and
are omitted from saved configurations and exports. Re-enter them after restarting
Flipper. Certificate/key files themselves remain at the paths you configure.

## Connecting an app

For USB Android: `adb reverse tcp:3000 tcp:3000`, then use
`http://localhost:3000` as the app's development API base URL (or HTTPS when enabled).
For LAN access bind to `0.0.0.0` and use the computer's LAN IP. The app must permit
development HTTP or trust your HTTPS certificate. Starting a mock does not
automatically redirect the app's real API requests.

## Storage and privacy

Environments persist at `~/.flipper/mock-api/environments.json`. Servers never
auto-start. Request/response traffic stays in memory (500 transactions per
environment, bodies displayed up to 64 KiB); it is not included in Flipper session
exports. User-supplied headers, bodies, file paths and templates in environments
are configuration data and are saved/exported as entered: review before sharing.
Proxy and callback features make requests only to the configured destinations.
There is no Mockoon Cloud connection.

Tests can set `FLIPPER_MOCK_API_DATA_DIR` to an isolated absolute directory without
using the normal workspace. Automated tests use synthetic configurations only.

Mockoon is MIT licensed, copyright 2017-present Guillaume Monnet. The distribution
preserves its license and dependency notices in `THIRD-PARTY-NOTICES.txt`.
