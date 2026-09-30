#!/usr/bin/env bash
# Build OpenSSL 3.5 LTS for Flipper with 16 KB ELF alignment.
# Prerequisites: NDK r27+, bash, curl, tar, full Perl (Pod::Usage), make, JDK jar.
set -euo pipefail
: "${ANDROID_NDK_HOME:?Set ANDROID_NDK_HOME to NDK r27 or newer}"
export ANDROID_NDK_ROOT="$ANDROID_NDK_HOME"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
VERSION=3.5.8
REVISION=$VERSION-16k
WORK="$ROOT/work/openssl-$VERSION-16k"
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
  curl -fL --retry 3 "https://github.com/openssl/openssl/releases/download/openssl-$VERSION/openssl-$VERSION.tar.gz" -o "$ARCHIVE"
fi
echo "a8f84a39918ec6415ce765d9b429d313ba97b8143169c172e734b9514464f5b2  $ARCHIVE" | sha256sum -c -
STAGE="$WORK/aar"
mkdir -p "$STAGE/prefab/modules/crypto/include/openssl" "$STAGE/prefab/modules/ssl/include/openssl"
chmod -R u+w "$STAGE"
printf '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="local.flipper.openssl" />\n' > "$STAGE/AndroidManifest.xml"
printf '{"name":"openssl","schema_version":1,"dependencies":[],"version":"%s"}\n' "$VERSION" > "$STAGE/prefab/prefab.json"
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
    perl Configure "$TARGET" -D__ANDROID_API__=21 no-tests no-asm no-module shared
    make build_generated
    make libcrypto.ld libssl.ld
    # OpenSSL 3's shared targets have different objects from the static archives
    # (including internal helpers used by libssl). Use the generated Makefile's
    # shared object lists, and response files to stay below Windows argv limits.
    for LIB in crypto ssl; do
      LIB="$LIB" perl -0777 -ne '
        my $name = $ENV{LIB};
        /^lib\Q$name\E\.so: ((?:[^\n]*\\\n)*[^\n]*)/m or die "Missing shared target lib$name";
        my @objects = $1 =~ /([A-Za-z0-9_.\/-]+\.(?:o|a))\b/g;
        @objects or die "Empty shared target lib$name";
        print "$_\n" for @objects;
      ' Makefile > "lib$LIB-objects.rsp"
      xargs -n 64 make -j"${JOBS:-8}" < "lib$LIB-objects.rsp"
      EXTRA=()
      if [ "$LIB" = ssl ]; then EXTRA=(-L. -lcrypto); fi
      clang --target="$TRIPLE" -shared -Wl,-soname,lib$LIB.so \
        -Wl,-z,defs -Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384 \
        -Wl,--version-script,lib$LIB.ld "@lib$LIB-objects.rsp" \
        "${EXTRA[@]}" -ldl -pthread -o "lib$LIB.so"
    done
  )
  for LIB in crypto ssl; do
    MODULE="$STAGE/prefab/modules/$LIB"
    mkdir -p "$MODULE/libs/android.$ABI" "$STAGE/jni/$ABI"
    cp -f "$BUILD/lib$LIB.so" "$MODULE/libs/android.$ABI/"
    cp -f "$BUILD/lib$LIB.so" "$STAGE/jni/$ABI/"
    cp -f "$BUILD/include/openssl/"*.h "$MODULE/include/openssl/"
    cp -f "$BUILD/include/openssl/configuration.h" "$MODULE/include/openssl/configuration-$ABI.h"
    chmod -R u+w "$MODULE/include"
    printf '{}\n' > "$MODULE/module.json"
    printf '{"abi":"%s","api":21,"ndk":27,"stl":"none"}\n' "$ABI" > "$MODULE/libs/android.$ABI/abi.json"
  done
done
for LIB in crypto ssl; do
  cat > "$STAGE/prefab/modules/$LIB/include/openssl/configuration.h" <<'HEADER'
#if defined(__aarch64__)
#include "configuration-arm64-v8a.h"
#elif defined(__arm__)
#include "configuration-armeabi-v7a.h"
#elif defined(__x86_64__)
#include "configuration-x86_64.h"
#elif defined(__i386__)
#include "configuration-x86.h"
#else
#error Unsupported Android ABI
#endif
HEADER
done
cp "$WORK/x86_64/openssl-$VERSION/LICENSE.txt" "$STAGE/LICENSE-OpenSSL"
REPO="$ROOT/android/third-party/generated-16k/maven/local/flipper/openssl/$REVISION"
mkdir -p "$REPO"
jar cf "$REPO/openssl-$REVISION.aar" -C "$STAGE" .
cat > "$REPO/openssl-$REVISION.pom" <<POM
<project><modelVersion>4.0.0</modelVersion><groupId>local.flipper</groupId><artifactId>openssl</artifactId><version>$REVISION</version><packaging>aar</packaging></project>
POM
echo "Built local.flipper:openssl:$REVISION"
