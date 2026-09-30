# Release validation

Every desktop release runs the complete root Jest suite, Electron process tests,
backend lifecycle tests and the packaged application smoke test on Windows x64,
Linux x64, macOS Intel and macOS Apple Silicon. Do not select only the plugins
used by the maintainer. From `desktop`, run `yarn test --runInBand` after installing
dependencies, then follow `RELEASING.md` for the native package checks.

The smoke test launches the actual packaged executable, imports 4,100 independently
generated synthetic logs, exercises filtering/reading position, checks spacing and
default wrapping, verifies renderer isolation, and verifies process shutdown.
It also imports two synthetic Mockoon environments using native file selection,
starts a real mock server, checks external-file change detection, reloads saved
edits, and stops the server. Mock API tests use an isolated storage directory.
Private user captures and any data derived from them are forbidden in remote
tests, source control, release packages and uploaded diagnostics.

## Existing coverage limits

The root suite covers the shared plugin framework, renderer, server, import/export,
packaging utilities and all existing public plugin suites. Plugin-specific suites
exist for Logs, Network, Crash Reporter, Databases, Inspector, Navigation,
Preferences, Mock API and the Sea Mammals example. Mock API exercises real HTTP,
HTTPS (built-in certificate, PEM/CA and encrypted PFX), request rules/templates,
proxy/response files, imports, persistence and source watching. This is not a claim of exhaustive code
coverage or real-device validation of every plugin.

The desktop plugins Cookies, Device CPU, Fresco, Hermes Debugger, KaiOS Graphs,
LeakCanary, React DevTools, UI Debugger and the other example/sandbox plugins do
not yet have dedicated desktop suites. Shared framework tests and successful
bundling do not replace their protocol or UI integration tests. The deprecated
KaiOS allocations plugin is not included in the desktop distribution.

The inherited suite explicitly skips 19 cases: seven plugin-container rendering
cases, six deep-link cases, two plugin-template generator cases, one legacy plugin
migration case, one emulator-launch UI case, one timing-sensitive Idler case and
one opt-in performance benchmark. They are retained as visible gaps, not counted
as passing. Four Unix-only cases run on Linux/macOS rather than Windows; two
timing-sensitive local cases are excluded on CI. Review these exclusions whenever
the corresponding functionality changes.

Android sample connectivity has been exercised on Windows. Packaged UI checks on
macOS/Linux use synthetic imported sessions, not a connected physical Android or
iOS device. Fresco needs an Android image-loading app; React/Hermes and KaiOS
plugins need compatible clients. Native iOS debugging requires its own macOS and
iOS integration checks. A green release workflow establishes only the checks
described above; it does not establish those missing integrations.
