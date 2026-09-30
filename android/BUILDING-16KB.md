# Building the Android sample with 16 KB support

The existing `:sample` app retains its plugins and screens. The native dependencies
are rebuilt for all four ABIs; changing only ZIP alignment does not fix their ELF
load segments.

## Windows prerequisites

- JDK 17, with `JAVA_HOME` and its `bin` directory on `PATH`.
- Android SDK, NDK `27.2.12479018`, CMake `3.22.1`, build-tools `36.0.0`.
- Git Bash, curl, tar, make and a complete Perl installation (`Pod::Usage`,
  `Locale::Maketext::Simple`, `ExtUtils::MakeMaker`). Git's minimal Perl may lack
  these modules. `PERL5LIB` can point to compatible complete Perl modules; with
  Git Bash, use a POSIX path such as `/c/tools/perl-lib`, not `C:\tools\perl-lib`.
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
- OpenSSL 3.5.8 LTS, Java-WebSocket 1.6.0 and OkHttp 4.12.0.
- Certificate requests use the correct PKCS#10 version encoding (zero), which
  OpenSSL 3 validates. Fresh desktop certificate exchange must be tested as well
  as startup; an app can start successfully and still fail while generating a CSR.
- Flipper, libevent, OpenSSL, Yoga, Flexlayout, Fresco native libraries and
  inspection tooling use 16 KB ELF load alignment.
- The JNI APIs and Java classes from the existing sample dependencies are kept.
- The Fresco sample uses the compatible Litho image component; its former Vito
  component called a Litho method absent from this version.
- The sample and tutorial exclude the Fresco plugin's transitive upstream Flipper
  dependency and use the local Android SDK. Build Tools use AGP's default version.
- The tutorial also uses Litho's compatible Fresco image component. Its native
  libraries are compressed (`jniLibs.useLegacyPackaging = true`) because AGP 8.2
  does not provide 16 KB ZIP alignment for uncompressed libraries. Android extracts
  them at install time, which increases installed disk usage. Build and check it
  with `./gradlew.bat :tutorial:assembleDebug` and
  `./scripts/check-apk-16k.ps1 -Apk android/tutorial/build/outputs/apk/debug/tutorial-debug.apk`.
- The sample POST and image URLs point to working public test resources.

OpenSSL is built from the pinned, SHA-256-verified 3.5.8 source archive. It is
linked using OpenSSL's shared-target object lists into `libcrypto.so` and
`libssl.so` with 16 KB alignment;
Flipper's native code must be rebuilt against its headers. Do not substitute
these libraries into an APK compiled against OpenSSL 1.1. OpenSSL providers are
built in (`no-module`); no external provider modules need to be shipped. OpenSSL
assembly and libjpeg SIMD remain disabled in these builds. Some Flipper RSA calls
use OpenSSL's deprecated, still-supported APIs and produce compiler warnings.

## Validation

The checker verifies every packaged arm64-v8a/x86_64 `.so` with `llvm-readelf` and
runs `zipalign -c -P 16`. Also install the APK on a 16 KB emulator/device, confirm
`adb shell getconf PAGE_SIZE` reports `16384`, exercise the sample screens and
image loading, and test the connection, Network and Logs with the Windows server.
Static alignment alone does not prove runtime compatibility. A 16 KB arm64 device
should also be tested before distributing an ARM production build.
