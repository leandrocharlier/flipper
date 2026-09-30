#!/usr/bin/env bash
# Build the existing OpenSSL 1.1 ABI for Flipper with 16 KB ELF alignment.
# Prerequisites: NDK r27+, bash, curl, tar, full Perl (Pod::Usage), make, JDK jar.
# OpenSSL 1.1.1 is EOL: this compatibility build is not a security upgrade to 3.x.
set -euo pipefail
: "${ANDROID_NDK_HOME:?Set ANDROID_NDK_HOME to NDK r27 or newer}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK="$ROOT/work/openssl-16k"
VERSION=1.1.1w
REVISION=1.1.1w-16k
case "$(uname -s)" in
  MINGW*|MSYS*) HOST=windows-x86_64 ;;
  Linux*) HOST=linux-x86_64 ;;
  Darwin*) HOST=darwin-x86_64 ;;
  *) echo 'Unsupported build host' >&2; exit 1 ;;
esac
export PATH="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/$HOST/bin:$ANDROID_NDK_HOME/prebuilt/$HOST/bin:$PATH"
# Do not translate Perl's POSIX module search paths when starting Windows make.
export MSYS2_ENV_CONV_EXCL="${MSYS2_ENV_CONV_EXCL:-};PERL5LIB"
perl -MPod::Usage -e 1
mkdir -p "$WORK"
ARCHIVE="$WORK/openssl-$VERSION.tar.gz"
if [ ! -f "$ARCHIVE" ]; then
  curl -fL --retry 3 "https://github.com/openssl/openssl/releases/download/OpenSSL_1_1_1w/openssl-$VERSION.tar.gz" -o "$ARCHIVE"
fi
echo "cf3098950cb4d853ad95c0841f1f9c6d3dc102dccfcacd521d93925208b76ac8  $ARCHIVE" | sha256sum -c -
STAGE="$WORK/aar"
mkdir -p "$STAGE/prefab/modules/crypto/include/openssl" "$STAGE/prefab/modules/ssl/include/openssl"
chmod -R u+w "$STAGE"
printf '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="local.flipper.openssl" />\n' > "$STAGE/AndroidManifest.xml"
printf '{"name":"openssl","schema_version":1,"dependencies":[],"version":"1.1.1.23"}\n' > "$STAGE/prefab/prefab.json"
for ABI in x86_64 arm64-v8a x86 armeabi-v7a; do
  case "$ABI" in
    x86_64) TARGET=android-x86_64; TRIPLE=x86_64-linux-android21 ;;
    arm64-v8a) TARGET=android-arm64; TRIPLE=aarch64-linux-android21 ;;
    x86) TARGET=android-x86; TRIPLE=i686-linux-android21 ;;
    armeabi-v7a) TARGET=android-arm; TRIPLE=armv7a-linux-androideabi21 ;;
  esac
  BUILD="$WORK/$ABI/openssl-$VERSION"
  if [ ! -d "$BUILD" ]; then
    mkdir -p "$WORK/$ABI"
    tar -xzf "$ARCHIVE" -C "$WORK/$ABI"
  fi
  (
    cd "$BUILD"
    perl Configure "$TARGET" -D__ANDROID_API__=21 no-tests no-asm shared
    make build_generated
    make -j"${JOBS:-8}" libcrypto.a libssl.a libcrypto.map libssl.map
    # Link archives to avoid Windows' command-line limit with hundreds of objects.
    clang --target="$TRIPLE" -shared -Wl,-soname,libcrypto.so \
      -Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384 \
      -Wl,--version-script,libcrypto.map -Wl,--whole-archive libcrypto.a \
      -Wl,--no-whole-archive -ldl -pthread -o libcrypto.so
    clang --target="$TRIPLE" -shared -Wl,-soname,libssl.so \
      -Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384 \
      -Wl,--version-script,libssl.map -Wl,--whole-archive libssl.a \
      -Wl,--no-whole-archive -L. -lcrypto -ldl -pthread -o libssl.so
  )
  for LIB in crypto ssl; do
    MODULE="$STAGE/prefab/modules/$LIB"
    mkdir -p "$MODULE/libs/android.$ABI" "$STAGE/jni/$ABI"
    cp -f "$BUILD/lib$LIB.so" "$MODULE/libs/android.$ABI/"
    cp -f "$BUILD/lib$LIB.so" "$STAGE/jni/$ABI/"
    cp -f "$BUILD/include/openssl/"*.h "$MODULE/include/openssl/"
    cp -f "$BUILD/include/openssl/opensslconf.h" "$MODULE/include/openssl/opensslconf-$ABI.h"
    chmod -R u+w "$MODULE/include"
    printf '{}\n' > "$MODULE/module.json"
    printf '{"abi":"%s","api":21,"ndk":27,"stl":"none"}\n' "$ABI" > "$MODULE/libs/android.$ABI/abi.json"
  done
done
for LIB in crypto ssl; do
  cat > "$STAGE/prefab/modules/$LIB/include/openssl/opensslconf.h" <<'HEADER'
#if defined(__aarch64__)
#include "opensslconf-arm64-v8a.h"
#elif defined(__arm__)
#include "opensslconf-armeabi-v7a.h"
#elif defined(__x86_64__)
#include "opensslconf-x86_64.h"
#elif defined(__i386__)
#include "opensslconf-x86.h"
#else
#error Unsupported Android ABI
#endif
HEADER
done
cp "$WORK/x86_64/openssl-$VERSION/LICENSE" "$STAGE/LICENSE-OpenSSL"
REPO="$ROOT/android/third-party/generated-16k/maven/local/flipper/openssl/$REVISION"
mkdir -p "$REPO"
jar cf "$REPO/openssl-$REVISION.aar" -C "$STAGE" .
cat > "$REPO/openssl-$REVISION.pom" <<POM
<project><modelVersion>4.0.0</modelVersion><groupId>local.flipper</groupId><artifactId>openssl</artifactId><version>$REVISION</version><packaging>aar</packaging></project>
POM
echo "Built local.flipper:openssl:$REVISION"
