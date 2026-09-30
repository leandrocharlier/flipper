# Community desktop releases

The community desktop version is in `electron/package.json` and its npm lockfile.
The embedded Flipper protocol/plugin version is kept separately in the desktop
workspace. Do not reset all workspace or Android package versions to the desktop
version: they have their own compatibility and publishing requirements.

## Build locally

Use Node 24, Yarn 1.22.22 and the committed lockfiles. From `desktop`:

```sh
yarn install --frozen-lockfile
yarn build:themes
yarn build:flipper-server --desktop
npm --prefix electron ci
npm --prefix electron test
npm --prefix electron run test:server
yarn test --runInBand
```

Close running Flipper instances before rebuilding/testing the backend.
Run `npm --prefix electron run dist:win`, `dist:mac` or `dist:linux` on the
corresponding operating system. macOS produces separate Intel and Apple Silicon
builds. Linux requires libsecret and an X11/Wayland desktop; use `xvfb-run` for
the packaged UI test in CI. Test the actual package with
`node electron/test/packaged.cjs` (the test creates synthetic logs only).

## GitHub Actions

The maintenance fork keeps these workflows:

- **Desktop CI**: TypeScript, the complete desktop Jest suite and process lifecycle
  checks on desktop changes/PRs, using Node.js 24. It does not publish artifacts.
- **Validate Gradle Wrapper**: verifies the wrapper on pushes/PRs.
- **Desktop release**: manual native builds/tests and GitHub publication.
- **Android CI**: builds all Android plugins and native dependencies, validates
  16 KB alignment and checks a standalone Maven consumer.
- **Publish Android**: manual Maven publishing after the complete Android checks.
  See [Maven release setup](../android/MAVEN.md) for the required private configuration.

Inherited Meta deployment/docs workflows, legacy package publishing and independent
JS/iOS/React Native example workflows have been removed. Those projects remain in
the source tree; their standalone checks are no longer automatic. Native desktop
builds and full packaged application checks remain mandatory in the release workflow.

Run **Desktop release** with the matching desktop version and release notes at
`desktop/releases/<version>.md`. Native runners build Windows x64, Linux x64,
macOS x64 and macOS arm64, run tests and upload the installers. The publish job
only runs after all four native builds and packaged-app tests pass.
The release gate runs the complete desktop Jest suite, regardless of which
plugins a maintainer uses. See `TESTING.md` for coverage limits and inherited
skips; skipped tests must never be reported as passing tests.

- `publish_release=true` creates the GitHub release and attaches SHA-256 checksums.
- `publish_android=true` is the normal default: dispatch Android/Maven publishing
  after the GitHub release. Maven credentials/signing and the Android publishing
  workflow must be validated separately before enabling it for a real release.
- For desktop-only releases, set `publish_android=false`. Desktop **0.3.0** and
  **1.0.0** used this option; Android **1.0.0** was published separately afterward.
- For a build rehearsal with no publication, also set `publish_release=false`.

Creating a desktop tag does not publish inherited npm or CocoaPods packages.
Desktop release creates
its tag from the exact tested commit, not from a moving branch after the build.

## Distribution notices and privacy

Keep the original MIT `LICENSE`, the fork's `NOTICE`, and all third-party
copyright/license texts. Packaging collects notices for the server and bundled
UI/plugin dependencies and includes Electron/Chromium, Node.js and JetBrains Mono
notices. Any supplemental upstream notice must record its source and version.
The Windows packages are unsigned; macOS builds are ad-hoc signed and not
notarized. Certificate-based signing/notarization is a separate setup.

Use only synthetic fixtures for CI and release tests. Private user exports,
imported sessions, local profiles, screenshots of user data, credentials and
signing keys must never enter Git, release packages or uploaded diagnostics.
CI diagnostics are limited to the synthetic packaged smoke test's own directory.
