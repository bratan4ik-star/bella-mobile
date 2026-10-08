#!/usr/bin/env bash
# Збирає підписаний APK з теки app/ у обгортці Android (WebView).
# Потрібні: JDK 17+, Android SDK (ANDROID_HOME) з build-tools і platforms.
# Змінні для підпису: KEYSTORE_FILE, KEYSTORE_PASSWORD, KEY_ALIAS (пароль ключа = пароль сховища).
# Необов'язково: ANDROID_CLIENT_ID (Client ID типу Android з Google Cloud, для входу через Google), VERSION_CODE, VERSION_NAME. Результат: android/build/fin-manager.apk
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -n "$SDK" ] || { echo "Не задано ANDROID_HOME"; exit 1; }
: "${KEYSTORE_FILE:?Не задано KEYSTORE_FILE}" "${KEYSTORE_PASSWORD:?Не задано KEYSTORE_PASSWORD}" "${KEY_ALIAS:?Не задано KEY_ALIAS}"

BT="$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)"
PLATFORM="$(ls -d "$SDK"/platforms/android-* | sort -V | tail -1)"
JAR="$PLATFORM/android.jar"
VERSION_CODE="${VERSION_CODE:-1}"
VERSION_NAME="${VERSION_NAME:-1.0}"
echo "build-tools: $BT"; echo "platform: $PLATFORM"

B="$ROOT/android/build"
rm -rf "$B"; mkdir -p "$B/res" "$B/classes" "$B/assets"

# Застосунок без service worker: у обгортці файли й так лежать на пристрої.
(cd "$ROOT/app" && cp -r index.html support.js Field.dc.html manifest.webmanifest icon-192.png icon-512.png vendor _ds "$B/assets/")

# Client ID для входу через Google підставляється в маніфест. Без нього вхід вимкнено.
CID="${ANDROID_CLIENT_ID:-}"
SCHEME="com.googleusercontent.apps.${CID%.apps.googleusercontent.com}"
[ -n "$CID" ] || SCHEME="ua.fin.manager.noauth"
sed -e "s|@@CLIENT_ID@@|$CID|" -e "s|@@SCHEME@@|$SCHEME|" "$ROOT/android/AndroidManifest.xml" > "$B/AndroidManifest.xml"

"$BT/aapt2" compile --dir "$ROOT/android/res" -o "$B/res"
"$BT/aapt2" link -o "$B/base.apk" -I "$JAR" --manifest "$B/AndroidManifest.xml" \
  --min-sdk-version 29 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" "$B"/res/*.flat

javac -nowarn --release 8 -cp "$JAR" -d "$B/classes" "$ROOT"/android/src/ua/fin/manager/*.java
"$BT/d8" --lib "$JAR" --min-api 29 --output "$B" $(find "$B/classes" -name '*.class')

(cd "$B" && zip -q base.apk classes.dex && zip -qr base.apk assets)
"$BT/zipalign" -p -f 4 "$B/base.apk" "$B/aligned.apk"
"$BT/apksigner" sign --ks "$KEYSTORE_FILE" --ks-pass env:KEYSTORE_PASSWORD --key-pass env:KEYSTORE_PASSWORD \
  --ks-key-alias "$KEY_ALIAS" --out "$B/fin-manager.apk" "$B/aligned.apk"
"$BT/apksigner" verify --print-certs "$B/fin-manager.apk" | head -3
echo "Готово: $B/fin-manager.apk ($(du -h "$B/fin-manager.apk" | cut -f1))"
