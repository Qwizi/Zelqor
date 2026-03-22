# MapLord TWA (Trusted Web Activity)

Android wrapper for MapLord — publishes the web app on Google Play.

## Prerequisites

- Android Studio or Android SDK command-line tools
- Java 17+
- A signing keystore for release builds

## Setup

### 1. Generate signing key

```bash
keytool -genkey -v -keystore maplord.keystore -alias maplord -keyalg RSA -keysize 2048 -validity 10000
```

### 2. Get SHA-256 fingerprint

```bash
keytool -list -v -keystore maplord.keystore -alias maplord | grep SHA256
```

### 3. Update assetlinks.json

Replace `REPLACE_WITH_YOUR_SIGNING_KEY_SHA256_FINGERPRINT` in `frontend/public/.well-known/assetlinks.json` with your SHA-256 fingerprint.

This file must be served at `https://maplord.qwizi.ovh/.well-known/assetlinks.json` for Chrome to trust the TWA and hide the URL bar.

### 4. Build

```bash
cd twa
./gradlew assembleRelease
```

The APK will be at `app/build/outputs/apk/release/app-release-unsigned.apk`.

### 5. Sign

```bash
apksigner sign --ks maplord.keystore --ks-key-alias maplord app/build/outputs/apk/release/app-release-unsigned.apk
```

### 6. Upload to Google Play

Upload the signed APK (or AAB) to [Google Play Console](https://play.google.com/console/).

## How TWA works

- The app opens `https://maplord.qwizi.ovh/dashboard` in Chrome without the URL bar
- Chrome verifies the Digital Asset Links (`assetlinks.json`) to confirm domain ownership
- All web features work: WebGL, WebSocket, push notifications, etc.
- Updates are automatic — change the website, the app updates
