# Windows build and Android integration

This fork offers a Windows desktop application using Electron 44 and the current
Flipper UI. It includes its own Node backend and opens in a desktop window. The
browser/server launcher remains available separately.

## Build

Use Node.js 24 LTS, Yarn 1.22.22, Git for Windows and an Android SDK. From `desktop`:

When updating an existing checkout, start from clean generated `node_modules`
directories (or a fresh checkout). Yarn Classic can retain obsolete nested Babel
copies after resolutions change; keep the committed lockfiles.

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

## Desktop executable and installer

From `desktop`, run:

```powershell
npx.cmd --yes yarn@1.22.22 build:desktop:win
```

Or, after building the server, run `npm.cmd ci` and `npm.cmd run dist:win` from
`desktop/electron`. Electron's dependencies have their own npm lockfile and do
not replace the existing Yarn dependencies. The build produces these artifacts
under `dist/electron`:

- `Flipper-0.3.0-win-x64.exe`: per-user NSIS installer.
- `Flipper-0.3.0-win-x64.zip`: portable folder containing `Flipper.exe`.

Extract the entire ZIP before opening `Flipper.exe`. Node is bundled; Android SDK
and OpenSSL still need to be installed as described above. The shell version is
0.3.0; the embedded Flipper backend and plugin versions remain 0.273.0.
The binaries are unsigned. Code signing requires a certificate owned by the fork
maintainer. No automatic update feed is configured.

The desktop app permits one instance per user profile, binds its HTTP interface
to IPv4 loopback, and retains Flipper's authentication. Opening it twice focuses
the existing window. Closing the last window stops its child backend. It refuses
to replace a separately running server using port 52342. If the desktop process
crashes, the backend exits when its parent IPC channel disconnects.

The renderer uses Electron's sandbox and context isolation with Node integration
disabled. External HTTP(S) links open in the default browser; other protocols and
webviews are blocked. Export downloads use the native Save dialog. The Help menu
opens the backend log folder. The initial Flipper setup wizard and plugin enable
controls work as before; expand Disabled to enable Network on a fresh profile.

## Desktop tests

From `desktop/electron`:

```powershell
npm.cmd test
npm.cmd run test:server
npm.cmd run test:smoke
# With the full sample installed on a single connected emulator-5554:
$env:FLIPPER_ANDROID_E2E = '1'
npm.cmd run test:smoke
```

The five process tests cover readiness, graceful shutdown, early and unexpected
failures, missing resources, and startup timeout. Two backend integration tests
verify port conflict protection and exit after parent IPC disconnection. Run them
with all other Flipper instances closed. The Electron smoke test runs the
real bootstrap, checks renderer isolation and UI loading, and closes the window
to verify graceful backend exit. The optional Android test uses the existing full
sample, triggers its GET and POST actions, verifies response bodies and log events,
and requires internet access to GitHub and httpbin. It also renders live Network
rows and verifies that the sample's Trigger notification button reaches desktop
Alerts when Example Plugin is enabled. Reports and screenshots are
written to the ignored `work` directory. These tests restart the sample app and
use a separate Electron profile.

## Validation scope

The dependency maintenance update includes Axios 1.20.0 (using its public HTTP
adapter), ws 8.22.0, Express 4.22.3, node-forge 1.4.0, form-data 4.0.6, tmp 0.2.7,
tar 7.5.22 and yauzl 3.4.0. Plugin extraction no longer uses `decompress`: tests
cover npm tarballs, VSIX ZIPs, invalid archives, traversal paths and links.
Run these additional suites from `desktop`:

```powershell
npx.cmd --yes yarn@1.22.22 test --runInBand plugin-lib/src/__tests__ flipper-server/src/commands/__tests__/DownloadFile flipper-server/src/plugins/__tests__/PluginManager.node.tsx
```

Together with the Network, Logs, Watchman and connection suites below, the
maintenance selection passes 81 tests and 21 snapshots (one Unix-only case skips
on Windows), plus seven Electron process/backend tests. A real HTTP download
test covers Axios streaming, beyond the existing mocked download tests.

The existing Network and Logs suites cover 29 tests. A new Watchman regression
test verifies that a missing executable cannot crash the server a minute later.
The connection and disconnection suites include a regression for an app connecting
before ADB registers its device: replacing the provisional device must also update
the app's device reference, keeping Logs available. These five test areas total
48 tests and 11 snapshots.
The Windows packaged server must also be tested against the Android sample:
secure certificate exchange, Network request/response bodies, and device log
events. See `android/BUILDING-16KB.md` for building the full sample.

The historical Windows checks do not establish macOS compatibility. The new
[desktop release workflow](RELEASING.md) builds and tests each OS on its native
runner; Windows cannot execute the Mac application. This work also
does not constitute a complete security upgrade of all the archived project's
dependencies.

## Logs text viewer checks

From `desktop`, run the Logs unit and component tests:

```powershell
npx.cmd --yes yarn@1.22.22 test --runInBand plugins/public/logs/__tests__/logs.node.tsx
```

After building the Windows server, start one Android emulator and close other
Flipper instances. From `desktop/electron`, run:

```powershell
.\node_modules\.bin\electron.cmd test/logs.cjs
```

The integration test sends device logs through ADB and checks multiline text,
severity colors, native Ctrl+C across events, selection stability, follow,
search/PID/tag filters, wrapping, capture pause/resume, repeated messages and
clearing. It clears the emulator's log buffer and copies test text to the
clipboard. Results and a screenshot are saved in `work/logs-electron`. Set
`$env:FLIPPER_LEAVE_OPEN='1'` to retain the tested window for manual inspection.

Set `$env:FLIPPER_PACKAGE_E2E='1'` with the existing full Android sample installed
to also check automatic package selection, the package column and PID discovery
after restarting the sample. The test also exercises the Logcat Format dialog.

## Artifact sizes for the dependency update

The 0.273.2 maintenance build was compared with the previously tested 0.273.1
desktop and full Android sample. Sizes are MiB (1,048,576 bytes):

| Artifact | Before | After | Change |
| --- | ---: | ---: | ---: |
| Full Android debug APK, four ABIs | 32.31 | 34.10 | +5.53% |
| Windows x64 installer | 161.29 | 162.36 | +0.67% |
| Windows x64 portable ZIP | 218.36 | 219.57 | +0.55% |

The final APK was packaged after `:sample:clean` to avoid unused space from
incremental APK updates. OpenSSL 3's native libraries account for the main content
increase. The ZIP's extracted application was tested in a path containing spaces,
including Android connectivity, single-instance behavior and normal shutdown.
