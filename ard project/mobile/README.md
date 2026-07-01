# Phoenix Door — Mobile app (Android, Kotlin)

The "digital card." A native Kotlin/Jetpack Compose app that emulates a
contactless card over **HCE**, presenting a short-lived rotating token to a door
reader. Matches the PhxFieldReports toolchain (Gradle 8.2 / AGP 8.2.2 / Kotlin
1.9.22).

> Android only. iOS cannot emulate a 3rd-party access card (Apple restricts HCE),
> so iPhone users carry a physical UID card.

## Build / run

Open `mobile/` in Android Studio and Run, or from the CLI:

```bash
# JAVA_HOME = Android Studio's JBR, ANDROID_HOME = your SDK
./gradlew :app:assembleDebug          # -> app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:testDebugUnitTest      # APDU + token-refresh unit tests
```

The backend URL is **baked into the app per deployment** — end users just log in
(email + password), like a campus card app. Set it at build time per client:

```bash
./gradlew assembleRelease -PdoorServerUrl=https://door.acme.com
```

The dev default is `http://10.0.2.2:4000` (the host's localhost as seen from the
emulator). A field tech can override it on the device via the login screen's
**Advanced** section, but it's hidden by default. Log in with a user that has a
phone credential issued from the admin dashboard.

## How it works

- **Login** → JWT stored in `EncryptedSharedPreferences` (`data/Prefs.kt`).
- **Card screen** → fetches the user's phone credential, then continuously mints a
  fresh rotating token (`/api/me/token`) before each expiry and writes it to
  `TokenStore` (encrypted). Shows NFC status + a "hold to reader" prompt.
- **HCE** (`hce/DoorHceService.kt`) → on a tap, Android routes the reader's SELECT
  of our AID here; the service returns the current token. See
  [../docs/hce-protocol.md](../docs/hce-protocol.md) for the byte-level contract.
- **History** → the user's recent taps from `/api/me/events`.

## Verified

`./gradlew :app:testDebugUnitTest` → 8 tests pass (APDU SELECT-AID framing + token
refresh scheduling). `:app:assembleDebug` produces a working debug APK.

On-device note: the actual NFC tap must be tested on **real hardware** (emulators
don't drive a real NFC field) against a door reader once the firmware is flashed.
