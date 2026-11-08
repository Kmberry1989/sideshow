# Sideshow

Floating toggle overlay that recalls saved Main Eventer details anywhere on the system. Hidden until a hotkey calls it up; click a saved field to copy it, paste it wherever you are working. Reads the same saved-event bank Main Eventer uses (Firestore `mainEvent_events`) — no separate data, no re-typing.

## Desktop (Windows + Mac)

One Electron codebase. Lives in the tray (Windows) / menu bar (Mac), no window on launch.

- **Hotkey:** `Ctrl+Shift+E` (Windows) / `Cmd+Shift+E` (Mac) toggles the panel. `Esc`, the hotkey again, or clicking away hides it.
- **Panel:** always on top. Lists saved events, each field as a chip — Name, Date, Start, End, Price, Ages, Host, Location. Click a chip to copy that exact value. Search filters the list. Starts empty when there are no saved events.
- **Sign-in:** Google sign-in, same allowlist as Main Eventer. The first sign-in opens the system browser; the refresh token is stored encrypted on the machine, so later launches sign in silently.

### Run it

```
cd desktop
cp firebase-config.example.json firebase-config.json
# fill in firebase-config.json (see below), then:
npm install
npm start
```

Package installers for Windows + Mac:

```
npm run pack
```

### firebase-config.json

Copy `firebase-config.example.json` to `firebase-config.json` and fill it in. It is gitignored and never committed.

- `firebase` — the Firebase web config for project `fired-arts-dashboard` (Firebase console → Project settings → Your apps → Web app). Same values Main Eventer uses.
- `googleOAuth` — a Desktop-app OAuth client for the same Google Cloud project (Google Cloud console → APIs & Services → Credentials → Create Credentials → OAuth client ID → Desktop app). Copy the Client ID and Client Secret.

## iOS keyboard

iOS cannot float an overlay over other apps, so the equivalent is a custom keyboard extension that types a saved field into any text box.

- **Container app:** sign in with Google, tap Sync. It writes the saved events into the shared App Group (`group.com.firedarts.sideshow`).
- **Keyboard:** shows the same events and fields. Tap a field to insert that exact value. Globe key switches keyboards; Done dismisses it.

### Build it (Xcode, Apple Developer account)

1. Open `ios/Sideshow.xcodeproj` in Xcode.
2. Select the Sideshow target → Signing & Capabilities → set Team to your Apple Developer account. Add the App Groups capability (`group.com.firedarts.sideshow`) to both targets — the entitlements files already list it.
3. Add `GoogleService-Info.plist` from the Firebase console (iOS app, bundle ID `com.firedarts.sideshow`) to the Sideshow target. A template is at `ios/GoogleService-Info.plist.example` — do not commit a real one.
4. In `ios/Sideshow/Info.plist`, replace `REVERSED_CLIENT_ID` with the reversed client ID from `GoogleService-Info.plist`.
5. Build and run on a real device (keyboard extensions need a device). Xcode resolves the Swift Package dependencies (Firebase iOS SDK, GoogleSignIn) on first build.

### Enable the keyboard

Settings → General → Keyboard → Keyboards → Add New Keyboard → Sideshow. Tap Sideshow and turn on **Allow Full Access** (required for the App Group). Switch to it with the globe key in any text field.

## Repo layout

- `desktop/` — Electron app (Windows + Mac).
- `ios/` — Xcode project: container app + keyboard extension. `gen_project.py` regenerates the `.pbxproj`; `validate_pbxproj.py` checks its structure.
