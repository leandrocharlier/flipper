# Building the Android sample with 16 KB support

The existing `:sample` app retains its plugins and screens. The native dependencies
are rebuilt for all four ABIs; changing only ZIP alignment does not fix their ELF
load segments.

## Windows prerequisites

- JDK 17, with `JAVA_HOME` and its `bin` directory on `PATH`.
- Android SDK, NDK `27.2.12479018`, CMake `3.22.1`, build-tools `36.0.0`.
- Git Bash, curl, tar, make and a complete Perl installation (`Pod::Usage`).
  Git's minimal Perl may not include this module. `PERL5LIB` can point to a
  compatible full Perl module directory.
- Network access for the pinned source archives and Maven dependencies.

From the repository root, build OpenSSL in Git Bash (use your SDK path):

```bash
export ANDROID_NDK_HOME=/c/Users/YOUR_USER/AppData/Local/Android/Sdk/ndk/27.2.12479018
bash scripts/build-openssl-16k.sh
```

Then run in PowerShell:

```powershell
./scripts/rebuild-sample-native.ps1
./gradlew.bat :sample:assembleDebug
./scripts/check-apk-16k.ps1 -Apk android/sample/build/outputs/apk/debug/sample-debug.apk
```

Generated AARs and their local Maven repository live in
`android/third-party/generated-16k/`, which survives `gradlew clean`. Sources and
intermediate builds live in `work/`. Both directories are ignored by Git. Run the
two native build scripts on a fresh checkout before building the app. Do not
publish the SDK with unresolved `local.flipper` or `-16k` dependencies: distribute
these rebuilt artifacts in your own Maven repository first.

## Changes and scope

- fbjni 0.7.0 and Android API 21 minimum.
- Flipper, libevent, OpenSSL, Yoga, Flexlayout, Fresco native libraries and
  inspection tooling use 16 KB ELF load alignment.
- The JNI APIs and Java classes from the existing sample dependencies are kept.
- The Fresco sample uses the compatible Litho image component; its former Vito
  component called a Litho method absent from this version.
- The sample POST and image URLs point to working public test resources.

OpenSSL 1.1.1w preserves the existing 1.1 ABI but is end-of-life. This build fixes
page-size compatibility; it is not a migration to a maintained OpenSSL major
version. OpenSSL assembly and libjpeg SIMD are disabled in these compatibility
builds. A later security/performance modernization needs separate testing.

## Validation

The checker verifies every packaged arm64-v8a/x86_64 `.so` with `llvm-readelf` and
runs `zipalign -c -P 16`. Also install the APK on a 16 KB emulator/device, confirm
`adb shell getconf PAGE_SIZE` reports `16384`, exercise the sample screens and
image loading, and test the connection, Network and Logs with the Windows server.
Static alignment alone does not prove runtime compatibility. A 16 KB arm64 device
should also be tested before distributing an ARM production build.
