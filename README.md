<p align="center">
  <img src="https://fbflipper.com/img/icon.png" alt="logo" width="20%"/>
</p>
<h1 align="center">
  Flipper
</h1>
<p align="center">
  <a href="https://central.sonatype.com/artifact/io.github.leandrocharlier.flipper/flipper">
    <img src="https://img.shields.io/maven-central/v/io.github.leandrocharlier.flipper/flipper" alt="Community Android Maven Badge" />
  </a>
  <a href="https://cocoapods.org/pods/Flipper">
    <img src="https://img.shields.io/cocoapods/v/FlipperKit.svg?label=iOS&color=blue" alt="iOS" />
  </a>
</p>

---
## About this fork

This is [Leandro Charlier's maintenance fork](https://github.com/leandrocharlier/flipper)
of the archived Meta Flipper project. Its current focus is native Android
debugging, especially **Network and Logs**, with a standalone desktop app.
Community version **1.0.0** includes Mock API and native desktop builds for Windows,
macOS (Intel and Apple Silicon), and Linux. See [desktop release instructions](desktop/RELEASING.md).
This fork is independent and is not an official Meta release. The original
MIT license and copyright notices are retained; see [NOTICE](NOTICE).
The Android Maven badge refers to this fork; the CocoaPods badge still refers to
the upstream iOS package. Android SDK version **1.0.0** uses the Maven group
`io.github.leandrocharlier.flipper`. See [integration, all plugin coordinates and
release checks](android/MAVEN.md). Every Android release includes all plugins and
their rebuilt native dependencies.

- Windows desktop restored with Electron 44: an `.exe` installer and a portable
  ZIP containing `Flipper.exe`, with Node.js 24 bundled. The browser launcher is
  still available.
- Android **16 KB page support** for the existing full sample, including rebuilt
  OpenSSL, Yoga, Flexlayout and Fresco libraries for all four ABIs.
- OpenSSL upgraded to **3.5.8 LTS**, Java-WebSocket to **1.6.0** and OkHttp to
  **4.12.0**. Desktop HTTP, WebSocket, cryptography and archive dependencies have
  also been updated; plugin archives reject traversal paths and links.
- Fixes for missing Watchman on Windows and for Logs disappearing when an app
  connects before ADB finishes registering its device.
- Logs now uses a Logcat-style text viewer with free text selection, severity
  colors, full multiline messages, search and level/tag/PID filters. Follow mode
  holds the view while selecting text; older history is available in blocks of
  2,000 events. See the [Logs guide](desktop/plugins/public/logs/docs/overview.mdx).
  Editing or clearing filters preserves the reading position and surrounding
  logs, including when no text is selected. Soft wrap is off by default.
- Android Logs can filter by package ID and follow the app selected in Flipper,
  refreshing process IDs after restarts. The Logcat Format panel configures
  visible fields, timestamp style, widths and colors, with saved preferences.
  Imported Android sessions can recover missing package names from explicit
  ActivityManager process lifecycles, with inferred names marked in tooltips.
- Choose **Flipper Dark** or **Island Dark** in **More → Settings → Theme Selection**.
  Island Dark uses Android Studio's Islands palette; the original Flipper Dark,
  light and system choices remain available. Apply saves the choice; Cancel
  restores the previous palette.
- Logs bundles JetBrains Mono with native text selection. Island Dark uses blue
  selection highlighting while preserving the text colors.
- Logs has one query field with completions (`package:mine`, `tag:`, `level:`,
  `message:`, `process:`, `pid:` and `tid:`) and a compact sidebar for capture,
  clearing, reloading, scrolling and formatting.

See [Windows build and tests](desktop/BUILDING-WINDOWS.md) and
[Android 16 KB build and tests](android/BUILDING-16KB.md). Windows and an Android
x86_64 16 KB emulator are the validation targets. macOS, iOS and ARM device runtime
compatibility require separate testing. The Windows binaries are unsigned.
This is an incremental maintenance effort: the archived project's entire
dependency tree has not been modernized or cleared of all security advisories.

Version 1.0.0 includes [Mock API](desktop/plugins/public/mock-api/README.md),
powered by Mockoon: multiple imported environments, local HTTP/HTTPS servers,
Start/Stop/reload controls and detection of changes to imported files. Select your
computer in the device selector to open it. The Android debug sample includes
HTTP and HTTPS buttons to exercise the local mock servers.

Upstream switched to a browser UI after [v0.239.0](https://github.com/facebook/flipper/releases/tag/v0.239.0).
This fork packages the newer UI in a desktop window again.

### React Native support

If you are debugging React Native applications, [v0.239.0](https://github.com/facebook/flipper/releases/tag/v0.239.0) will be the last release with support for it due to technical limitations for React Dev Tools and Hermes Debugger plugins. As such, please refer to that release when debugging React Native applications.

Restoring the Windows desktop window does not restore support for current React
Native, React DevTools or Hermes versions. The legacy examples below are retained
as upstream reference material.

---

<p align="center">
  Flipper is a platform for debugging mobile apps on iOS and Android and JS apps in your browser or in Node.js. Visualize, inspect, and control your apps from a simple desktop interface. Use Flipper as is or extend it using the plugin API.
</p>

![Flipper](website/static/img/inspector.png)

## Table of Contents

- [In this repo](#in-this-repo)
- [Getting started](#getting-started)
  - [Requirements](#requirements)
- [Building from Source](#building-from-source)
  - [Desktop](#desktop)
    - [Running from source](#running-from-source)
    - [Building standalone application](#building-standalone-application)
  - [iOS SDK + Sample App](#ios-sdk--sample-app)
  - [Android SDK + Sample app](#android-sdk--sample-app)
  - [React Native SDK + Sample app](#react-native-sdk--sample-app)
  - [JS SDK + Sample React app](#js-sdk--sample-react-app)
    - [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)
  - [Contributing](#contributing)
  - [License](#license)

## Mobile development

Flipper aims to be your number one companion for mobile app development on iOS
and Android. Therefore, we provide a bunch of useful tools, including a log
viewer, interactive layout inspector, and network inspector.

## Extending Flipper

Flipper is built as a platform. In addition to using the tools already included,
you can create your own plugins to visualize and debug data from your mobile
apps. Flipper takes care of sending data back and forth, calling functions, and
listening for events on the mobile app.

## Contributing to Flipper

Both Flipper's desktop app, native mobile SDKs, JS SDKs are open-source and MIT
licensed. This enables you to see and understand how we are building plugins,
and of course, join the community and help to improve Flipper. We are excited to
see what you will build on this platform.

# In this repo

This repository includes all parts of Flipper. This includes:

- Flipper's desktop app built using [Electron](https://electronjs.org)
  (`/desktop`)
- native Flipper SDKs for iOS (`/iOS`)
- native Flipper SDKs for Android (`/android`)
- cross-platform C++ SDK (`/xplat`)
- React Native Flipper SDK (`/react-native`)
- JS Flipper SDK (`/js`)
- Plugins (`/desktop/plugins/public/`)
- website and documentation (`/website`, `/docs`)

# Getting started

Build this fork using the guides linked above. The upstream
[Getting Started guide](https://fbflipper.com/docs/getting-started) explains the
general plugin setup. `npx flipper-server` installs the upstream npm package;
it does not include this fork's changes.

## Requirements

- Node.js 24 LTS for the desktop build
- Yarn 1.22.22; npm for the isolated `desktop/electron` package
- iOS developer tools (for developing iOS plugins)
- Android SDK and adb
- JDK 17, NDK r27 and native build tools for the Android sample (see its guide)
- OpenSSL on PATH for desktop certificate generation (Git for Windows provides it)

# Building from Source

## Desktop

### Running from source

```bash
git clone https://github.com/leandrocharlier/flipper.git
cd flipper/desktop
yarn
yarn start
```

### Building standalone application

On Windows, from `desktop`:

```bash
yarn build:desktop:win
```

The installer and portable ZIP are written to `dist/electron/`. Extract the entire
ZIP before starting `Flipper.exe`. See the [Windows guide](desktop/BUILDING-WINDOWS.md)
for prerequisites and integration tests. The separate browser/server build remains
available with `yarn build:flipper-server --win`; the upstream `--mac` and `--linux`
paths require their own platform validation.

## iOS SDK + Sample App

```bash
cd iOS/Sample
rm -f Podfile.lock
pod install --repo-update
open Sample.xcworkspace
<Run app from xcode>
```

You can omit `--repo-update` to speed up the installation, but watch out as you
may be building against outdated dependencies.

## Android SDK + Sample app

First rebuild the native artifacts as described in the
[Android 16 KB guide](android/BUILDING-16KB.md). Then start an emulator and run
the following in the project root:

```bash
./gradlew :sample:installDebug
```

## React Native SDK + Sample app

> Requires RN 0.69+!

```bash
cd react-native/ReactNativeFlipperExample
yarn
yarn android
```

Note that the first 2 steps need to be done only once.

Alternatively, the app can be started on `iOS` by running `yarn ios`.

If this is the first time running, you will also need to run
`pod install --repo-update` from the
`react-native/ReactNativeFlipperExample/ios` folder.

### React Native Windows (Experimental)

An experimental version of Flipper for React Native Windows is available. The
following steps prepare the React Native Flipper project:

```bash
cd react-native/react-native-flipper
vcpkg install openssl:x64-uwp openssl:arm-uwp
vcpkg integrate install
yarn install
cd windows
nuget install ReactNativeFlipper/packages.config
```

In a nutshell, [vcpkg](https://vcpkg.io/) is used to install
[OpenSSL](https://www.openssl.org/). Nuget is used to install
[Boost](https://www.boost.org/).

Then, the sample application can be built and run as follows:

```bash
cd ../../ReactNativeFlipperExample
yarn install
yarn relative-deps
npx react-native run-windows
```

At the moment there's no available package for React Native Flipper. This means
that to integrate Flipper with any other existing applications, an explicit
reference to the project needs to be added just as is done with the sample
application.

## JS SDK + Sample React app

```bash
cd js/react-flipper-example
yarn
yarn start
```

#### Troubleshooting

Older yarn versions might show an error / hang with the message 'Waiting for the
other yarn instance to finish'. If that happens, run the command `yarn` first
separately in the directory `react-native/react-native-flipper`.

# Documentation

Find the full documentation for this project at
[fbflipper.com](https://fbflipper.com/).

Our documentation is built with [Docusaurus](https://docusaurus.io/). You can
build it locally by running this:

```bash
cd website
yarn
yarn start
```

## Contributing

See the [CONTRIBUTING](/CONTRIBUTING.md) file for how to help out.

## License

Flipper is MIT licensed, as found in the [LICENSE](/LICENSE) file.
