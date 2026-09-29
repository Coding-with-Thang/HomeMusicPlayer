# HomeAudioPlayer

HomeAudioPlayer is a mobile-first music player built with Expo and React Native. It plays audio stored on the device and can privately stream a Windows PC music library over Tailscale.

## Features

- Import individual audio files or recursively scan selected device folders.
- Play MP3, M4A, AAC, WAV, FLAC, OGG, and Opus files.
- Read embedded song metadata and artwork.
- Search, filter, and sort the library by title, artist, album, genre, year, track number, source, or format.
- Build a live queue and reusable saved playlists.
- Shuffle, repeat, seek, skip, and use background/lock-screen playback controls.
- Edit metadata for supported local files and remote files on the paired PC.
- Choose light, dark, or system appearance, an accent color, and customizable now-playing visualizations.
- Pair with the optional Windows companion to browse folders, sync metadata, and stream music through private Tailscale HTTPS.

## Requirements

- Node.js 22 or newer
- npm
- An Android or iOS device, emulator, or simulator supported by Expo SDK 57
- For PC streaming: a Windows PC and [Tailscale](https://tailscale.com/) on both the PC and mobile device

## Mobile app setup

Install the dependencies:

```bash
npm install
```

The install step also applies the required `@missingcore/audio-metadata` compatibility patch through `patch-package`.

Start the Expo development server:

```bash
npm start
```

Other available commands:

```bash
npm run android
npm run ios
npm run web
npm run start:tunnel
```

The iOS simulator command requires macOS. The web command is available, but the project is mobile-first and features that depend on native audio, filesystem, metadata, secure-storage, or folder-picker APIs may be limited. If a feature is unavailable in Expo Go, run it in an Expo development build.

### Add music from the device

1. Open **Library**.
2. Select **Scan Device**.
3. Add one or more folders and enable the folders to include.
4. Select **Scan & Update Library**.

Folder permissions are retained by the operating system when supported. The app stores its library, queues, playlists, scan locations, and preferences locally on the device.

## Windows companion

The optional companion service indexes music folders on a Windows PC and exposes them only through loopback ports. Tailscale Serve provides private HTTPS access to the mobile app.

### Set up the companion

From the `companion` directory:

```bash
cd companion
npm install
npm start
```

Use `npm run dev` instead of `npm start` while developing the companion to restart it automatically after source changes.

Then:

1. Copy the one-time setup code printed in the terminal.
2. Open `http://127.0.0.1:47831`, enter the code, and create an admin password of at least 12 characters.
3. Add music folders from the admin page, or choose them later in the mobile app.
4. In an Administrator PowerShell window, run:

   ```powershell
   tailscale serve --bg 47832
   ```

5. On the admin page, generate a pairing code.
6. In the mobile app, open **Settings → PC streaming**.
7. Enter the generated `https://*.ts.net` address and pairing code, then connect and sync.

Use Tailscale **Serve**, not the public **Funnel** feature. Both companion ports must remain bound to `127.0.0.1`.

After setup, `companion/scripts/install-startup.ps1` can install the companion as a Windows sign-in task. See [companion/README.md](companion/README.md) for device revocation, read-only access, metadata editing, and security details.

### Companion data

By default, configuration is saved under:

```text
%LOCALAPPDATA%\HomeAudioPlayerCompanion
```

Set `HOME_AUDIO_PLAYER_DATA_DIR` to use a different directory.

## Development

Run the mobile checks:

```bash
npm run lint
npx tsc --noEmit
```

Run the companion checks:

```bash
cd companion
npm test
npm run typecheck
```

## Project structure

```text
App.tsx                    Main app shell and player UI
useLocalAudioPlayer.ts     Playback, library, queue, playlist, and sync state
MusicLibraryScreen.tsx     Searchable and sortable music library
DeviceScanScreen.tsx       Device folder selection and recursive scanning
SettingsScreen.tsx         Appearance, visualization, and PC connection settings
remoteServer.ts            Authenticated mobile companion client
theme.tsx                  Theme state and color tokens
companion/                 Windows indexing and streaming service
```

## Privacy and security

- Local music and app preferences stay on the device.
- The companion API and admin page listen on loopback only.
- Remote requests use a random per-device bearer token stored in Expo SecureStore.
- Tailscale Serve supplies private HTTPS; pairing tokens can also be bound to a Tailscale identity.
- Disconnecting revokes the device token when the PC is reachable.
- Companion administrators can revoke devices or limit them to read-only playback.

The companion does not protect files from malware already running as the same Windows user, because that process already has access to the user's files.
