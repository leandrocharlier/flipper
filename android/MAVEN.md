# Android Maven release

All Android plugins are built, validated and released together, including plugins
not used by the sample. Group: `io.github.leandrocharlier.flipper`; version: `1.0.0`.
Java package names remain `com.facebook.flipper`; do not combine this SDK with
the upstream `com.facebook.flipper` Maven artifacts in the same application.

Version **1.0.0 is published on Maven Central**. All 15 artifacts were downloaded
from Central and checked against the reviewed publication (136 files), and the
synthetic consumer compiled in debug and release using only Google and Central.
Verify availability with `python scripts/check-maven-central.py --expect published`.
Published versions cannot be overwritten; use a new version for the next release.

```groovy
repositories { google(); mavenCentral() }
dependencies {
    debugImplementation 'io.github.leandrocharlier.flipper:flipper:1.0.0'
    debugImplementation 'io.github.leandrocharlier.flipper:flipper-network-plugin:1.0.0'
    releaseImplementation 'io.github.leandrocharlier.flipper:flipper-noop:1.0.0'
}
```

Register plugins and the OkHttp interceptor in debug-only application code as in
the sample. Logcat capture and desktop Mock API do not require an Android plugin.
Apps using AGP 8.2 must compress native libraries with
`android.packagingOptions.jniLibs.useLegacyPackaging = true`; ELF alignment and
APK ZIP alignment are separate requirements. Check the final APK on a 16 KB
device. Minimum Android API is 21; optional plugins may require a higher minimum.

## Complete publication set

SDK/plugins: `flipper`, `flipper-noop`, `flipper-network-plugin`,
`flipper-litho-plugin`, `flipper-leakcanary-plugin`, `flipper-leakcanary2-plugin`,
`flipper-retrofit2-protobuf-plugin`, `flipper-jetpack-compose-plugin`.

Rebuilt dependencies: `flipper-openssl`, `flipper-yoga`, `flipper-flexlayout`,
`flipper-imagepipeline-native`, `flipper-nativeimagefilters`,
`flipper-nativeimagetranscoder`, `flipper-inspection-lib`.

The Litho plugin declares the rebuilt Yoga/Flexlayout dependencies and excludes
their upstream native binaries. If your app directly depends on upstream Fresco,
exclude its `imagepipeline-native`, `nativeimagefilters` and
`nativeimagetranscoder` artifacts on those dependencies and add the corresponding
community artifacts above. The upstream `com.facebook.fresco:flipper-fresco-plugin:3.1.3`
also needs an exclusion for `com.facebook.flipper:flipper`. Keep the Fresco Java
dependencies compatible with 3.1.3. Do not resolve duplicate native files using
`pickFirst`: that can silently select a library without 16 KB support.

## Validation before publishing

Use JDK 17, Gradle 8.14.3 and AGP 8.2.2. First rebuild the native dependencies
following [BUILDING-16KB.md](BUILDING-16KB.md), then run:

```text
gradlew :third-party:prepare
gradlew stageAndroidPublication testDebugUnitTest
python scripts/validate-maven-artifacts.py
python scripts/create-maven-consumer.py
gradlew -p work/maven-consumer assembleDebug assembleRelease verifyPublishedDependencyGraph
```

On a fresh checkout, run `:third-party:prepare` in a separate Gradle invocation:
it generates the Folly and other native Gradle projects before test dependencies
are resolved during configuration.

The generated consumer uses the isolated local Maven repository, not project
dependencies or `mavenLocal()`. Install its debug APK on a 16 KB emulator and
check SDK startup. After Central publication, regenerate it with `--central-only`
and repeat dependency resolution and compilation. Unit tests and an aggregate
consumer do not replace real-device integration tests for every optional plugin.

### Published dependency integration tests

Local validation of Maven **1.0.0** on September 30, 2026 passed **22 debug tests
and 1 no-op test** on Android 15 x86_64 with 16 KB pages. The Windows v1.0.0 release
server also passed the SDK connection, plugin RPC, HTTP response and log roundtrip.
All 28 arm64/x86_64 native libraries in the consumer APK passed ELF alignment,
and the APK passed ZIP alignment. This is the tested matrix, not a guarantee for
other devices or framework versions. React Native example coordinates were
updated, but the legacy React Native application was not built in this validation.

The consumer can include repeatable device tests against the actual Central
binaries, without rebuilding or substituting SDK projects:

```text
python scripts/create-maven-consumer.py --version 1.0.0 --central-only --integration-tests
gradlew -p work/maven-consumer connectedDebugAndroidTest verifyPublishedDependencyGraph verifyCompletePublicationGraph
gradlew -p work/maven-consumer -PconsumerTestBuildType=release connectedReleaseAndroidTest
```

Use a connected Android 15 x86_64 emulator configured with 16 KB pages. The debug
suite checks page size, SDK registration, HTTP/HTTPS interception with a trusted
ephemeral test certificate, both LeakCanary report formats, Retrofit protobuf
schemas, Sections events, rendered Compose/Litho inspection, SQLite, preferences,
navigation, crash reports, sandbox selection, the legacy React compatibility
stub, Fresco Images cache enumeration, and native image/layout operations.
All 14 debug modules must resolve at the requested version. Release must contain
only the no-op SDK and annotations, with no native libraries in its APK.

The integration fixture enables Kotlin/Compose and uses Compose 1.6.7, Litho
0.50.1 and Fresco 3.1.3, matching the supported sample setup. A Java-only
consumer that does not enable Kotlin Android can resolve Compose's multiplatform
metadata instead of Android classes; enable Kotlin Android when testing Compose.
The no-op exposes a subset of the SDK API, as documented in the Android setup
guide. These tests do not claim compatibility with every Compose, Fresco, React
Native or Android version. LeakCanary tests supply synthetic analyzed reports;
they do not perform an actual heap dump or verify automatic leak detection.

For a real desktop-server roundtrip, install the generated debug APK, close any
running Flipper instance, and run:

```text
adb install -r work/maven-consumer/build/outputs/apk/debug/synthetic-maven-consumer-debug.apk
node scripts/test-maven-desktop.cjs PATH_TO_DESKTOP_RELEASE/resources/server
```

This starts and stops its own server, checks the published client's connection,
plugin RPC, Network request/response and synthetic log delivery. It uses only a
loopback HTTP endpoint. `ANDROID_SERIAL` selects the emulator (default:
`emulator-5554`), and `ADB` can specify the executable. Test results and generated
apps stay under ignored `work/`. The test release APK is debuggable and signed
with the existing machine-local app signing configuration solely to run tests;
it is not a production application or a published artifact.

Execution on x86_64 does not replace execution on a physical arm64 device. Use
`scripts/check-apk-16k.ps1` to additionally check every arm64/x86_64 ELF and APK
ZIP alignment; a static arm64 check is not an arm64 runtime test. The desktop
roundtrip exercises the release server, not every plugin's desktop UI or macOS.

Only a complete, signed set of all 15 artifacts can be released. Each publication
includes sources, documentation/license notices and its POM. Native sources are
pinned and rebuilt with all four ABIs; native documentation jars contain notices,
not generated Java API documentation. Original licenses and copyright notices are
preserved in the packages.

Before uploading, `scripts/verify-maven-signatures.py` downloads the public key
from a supported keyserver and verifies every staged signature in a fresh,
public-only keyring. A new or rotated key must be distributed first, and its
expected fingerprint updated. Central may still need time to refresh its own
key lookup; local verification does not guarantee instant server availability.

## Private signing configuration

### GitHub Actions

`Android CI` rebuilds and validates every Android plugin and native dependency on
Android changes. `Publish Android` reuses those checks and publishes only when
explicitly dispatched. Desktop releases request Android publishing by default.
The release check stops before building if the version already exists on Central.

CI publishing requires the repository Actions secrets `MAVEN_CENTRAL_USERNAME`,
`MAVEN_CENTRAL_PASSWORD`, `MAVEN_SIGNING_KEY` (an armored private OpenPGP key), and
`MAVEN_SIGNING_PASSWORD` (its passphrase, when protected). Adding the workflow does
not configure these secrets. Transferring a private key to GitHub Secrets is a
separate maintainer decision; keep publishing locally until that is approved and
configured. Never commit these values or upload them as workflow artifacts.

The existing desktop tag `v1.0.0` predates the Maven configuration and must not be
moved or reused to publish Android. Maven 1.0.0 was published locally after that
desktop release. Future combined releases need matching desktop and Android
versions, the publishing workflow present at the release tag, and CI secrets set.

### Local publishing and sample signing

Maven publishing credentials stay in ignored root `local.properties` for local
publishing. The private GPG key stays under ignored `.publishing/`. Only public
verification keys and detached `.asc` signatures are distributed; a signature
does not contain the private signing key. Never copy local properties or a key
directory into sources, release assets or a Maven bundle.

Android app signing is separate from Maven GPG signing. Local example keystores
live under ignored `.signing/`. Root `local.properties` supplies these fields for
each of `sample`, `tutorial` and `reactNativeExample`:

```properties
androidSigning.sample.storeFile=.signing/sample.p12
androidSigning.sample.storePassword=YOUR_LOCAL_PASSWORD
androidSigning.sample.keyAlias=YOUR_LOCAL_ALIAS
androidSigning.sample.keyPassword=YOUR_LOCAL_PASSWORD
```

Repeat the same field names with the other app prefixes. The repository contains
no shared debug keystore. Fresh clones without explicit signing configuration
use the Android plugin's machine-local debug key. Changing an installed app's
signing key requires uninstalling its previous build first, which clears that
app's data; do not uninstall automatically.

`android/publication-privacy.gradle` checks publication archives, nested jars and
metadata before Maven writes, rejecting local files, private-key material and
known local credentials. `scripts/check-private-files.py` checks the Git index;
`--pre-push` checks new commits from Git's hook input. These checks complement
review and `.gitignore`; hooks can be bypassed and do not remove historical files.
