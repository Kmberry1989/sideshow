# Sideshow

Floating toggle overlay that recalls saved Main Eventer details anywhere on the system. Hidden until a hotkey calls it up; click a saved field to copy it, paste it wherever you are working. Reads the same saved-event bank Main Eventer uses (Firestore `mainEvent_events`) — no separate data, no re-typing.

## Desktop (Windows + Mac)

One Electron codebase. Lives in the tray (Windows) / menu bar (Mac), no window on launch.

- **Hotkey:** `Ctrl+Shift+E` (Windows) / `Cmd+Shift+E` (Mac) toggles the panel. `Esc`, the hotkey again, or clicking away hides it. Change it in the panel (Hotkey setting) — click it, press a new combination. Saved between launches; if the new one is taken or invalid, the old one stays.
- **Gesture:** an optional mouse gesture that summons the panel (same as the hotkey). Record one in the panel (Gesture setting): a drag direction, a click combination (3+ rapid clicks), or a press-and-hold of a recorded length. Works on Windows and Mac via a low-level mouse hook; on Mac it needs Accessibility permission. No gesture is required — the hotkey always works.
- **Single keys:** when the panel is open, press a letter to copy that field from the focused event (the card you last clicked): `n` name, `d` date, `t` time range, `p` price, `a` ages, `h` host, `l` location. Each chip shows its key. Never fires while typing in the search box or another app.
- **Panel:** always on top, appears next to the cursor (flips/clamps at screen edges). Lists saved events, each field as a chip — Name, Date, Start, End, Price, Ages, Host, Location. Click a chip to copy that exact value; the chip pops and a copy icon + drawing checkmark confirm it (blue on Mac, green on Windows). Search filters the list. Starts empty when there are no saved events.
- **Sound:** gentle bubbly blips (synthesized in code, no audio files) for copy, panel open/close, and focus change. Sound toggle in the panel; on by default.
- **Motion:** Full / Reduced / Off in the panel. Follows the OS reduced-motion preference when unset. Reduced keeps a minimal fade; Off changes state instantly. The copy checkmark still shows either way.
- **Reminders:** 1 day and 1 hour before each event (events with a date and start time only; past events skipped). Each fires once — tracked persistently, so a restart never re-fires one. A system notification shows the event name + date/time; clicking it opens the panel on that event. Reminders toggle in the panel; on by default.
- **Badge:** count of upcoming events (today or later) on the tray icon, the Mac dock badge, and the Windows taskbar badge where supported. Clears at zero.
- **Accent:** pick an accent color in the panel (Accent swatches: Default, Terracotta, Clay, Gold, Green, Teal, Blue, Plum). One color for the copy confirmation and all UI accents (buttons, focus, selected states). Default is the platform color — blue on Mac, green on Windows. The Default swatch goes back to it. Saved between launches.
- **Sign-in:** Google sign-in, same allowlist as Main Eventer. The first sign-in opens the system browser; the refresh token is stored encrypted on the machine, so later launches sign in silently.

Every setting above is optional. The core — summon the panel, list events, click to copy — works fully with all of them off or at defaults, and no feature blocks launch, sign-in, loading, or copying.

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
npm run pack          # portable zips (electron-packager, win32 + darwin)
npm run dist:win      # Windows setup .exe (electron-builder NSIS)
npm run dist:win-native  # Windows setup .exe, built here with native makensis (no Wine)
npm run dist:mac      # Mac .dmg (electron-builder; needs macOS — run on a Mac)
```

The Windows setup .exe is an NSIS installer (installs, Start Menu + Desktop shortcuts). On this Linux VM, `npm run dist:win` (electron-builder) produces only a stub .exe — its NSIS embedding does not work here, and its post-build Wine check needs 32-bit Wine, which this VM cannot install. So the Linux-built installer uses the native `makensis` instead (`npm run dist:win-native`, script `desktop/installer.nsi`): it packages the app with electron-builder (`--win --dir`) and compiles a self-contained setup .exe with the system `makensis` (package `nsis`). The Mac .dmg cannot be built on Linux. The app icon is a striped sideshow tent (terracotta/cream on deep brown); the wordmark is in `desktop/assets/wordmark.png` (light) and `wordmark-light.png` (dark).

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
