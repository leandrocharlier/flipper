# Windows build and Android integration

This revision uses Flipper's browser UI with a local Windows server, not the
discontinued Electron application.

## Build

Use Node.js 24 LTS, Yarn 1.22.22, Git for Windows and an Android SDK. From `desktop`:

```powershell
npx.cmd --yes yarn@1.22.22 install --frozen-lockfile
npx.cmd --yes yarn@1.22.22 test --runInBand --watch=false plugins/public/network/__tests__ plugins/public/logs/__tests__ pkg-lib/src/__tests__/watchman.node.tsx
npx.cmd --yes yarn@1.22.22 build:flipper-server --win
```

The Windows output is `dist/flipper-server-windows` at the repository root. Keep
the entire directory together and start `flipper.bat`. Node.js 24.21.0 is included
and checked against the official SHA-256 list during packaging; the machine
running the bundle does not need a separate Node installation.

The launcher adds the default Android SDK platform-tools and Git for Windows'
OpenSSL directory to its process PATH when present. For custom installations,
make `adb` and `openssl` available on PATH and configure the SDK location in
Flipper. The UI normally opens at `http://localhost:52342`.

## Validation scope

The existing Network and Logs suites cover 29 tests. A new Watchman regression
test verifies that a missing executable cannot crash the server a minute later.
The Windows packaged server must also be tested against the Android sample:
secure certificate exchange, Network request/response bodies, and device log
events. See `android/BUILDING-16KB.md` for building the full sample.

These tests do not establish macOS compatibility. macOS still needs its own
runtime update, packaging and execution tests on Apple hardware. This work also
does not constitute a complete security upgrade of all the archived project's
dependencies.
