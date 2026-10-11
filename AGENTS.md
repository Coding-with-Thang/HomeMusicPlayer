This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## Gapless playback and Expo playlist API

Do **not** migrate queue playback to `useAudioPlaylist` / `AudioPlaylist` until the checklist below passes on the current Expo SDK. On SDK 57.0.5 the playlist API drops per-source `headers`, has no lock-screen / media-session support, and cannot move or replace the current item.

Until then, keep the current single-track `AudioPlayer` and the near-gapless handoff in `useLocalAudioPlayer.ts` (early switch near track end plus `preload()` of the next local or cached file).

If true gapless is needed before Expo closes those gaps, prefer a custom Media3 player module (option D) over a large `expo-audio` playlist patch (option B). A custom module can keep authenticated remote sources, lock-screen controls, and headset next/previous in one place.

### Playlist-API compatibility checklist

Re-run after every Expo / `expo-audio` upgrade. Migrate only if every item passes:

- Playlist items send `headers`. A queue of 3 PC tracks (bearer auth) all play, and the next track starts with no 401.
- Mixed queue (device file, PC, device file) transitions on a gapless test album (a sine sweep split across tracks) with no extra silence.
- `setActiveForLockScreen` or an equivalent works on a playlist: lock screen, notification, Bluetooth metadata, and headset next/previous all work during playlist playback.
- Items can be moved or replaced in place. Shuffle, repeat one/all, reordering the queue, and removing the current track while playing all keep the playing item intact.
- Turning the PC off mid-queue: cached tracks keep playing and uncached ones are skipped.
- Background playback continues for 30+ minutes with the screen off.
