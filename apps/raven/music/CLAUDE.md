# Claude context for Wren

`@raven/music` is Wren, raven's music app for iPhone, iPad and Android phones: an Expo app with `expo-router`, touch only, with a look of its own. Its design is `docs/superpowers/specs/2026-10-27-raven-audio-design.md` (PR 8 on), and its plan `docs/superpowers/plans/2026-10-30-raven-music-standalone.md`. The rules that apply to it are in the root `CLAUDE.md` and `apps/raven/CLAUDE.md`; this file holds what only Wren needs.

## Names

- The app is named Wren, so the Xcode workspace and scheme are `Wren` and the simulator build is `build/ios/Build/Products/Release-iphonesimulator/Wren.app`.
- The iOS bundle id and the Android package are both `app.netlify.wren`; the slug and the link scheme are `wren`. Anything hosted lives on Netlify.

## Shared with the device app

- **The fork and the pins are `@raven/app`'s.** Wren runs on `react-native-tvos` too, since the root `overrides` sets `react-native` for the whole workspace, and every Expo and React Native package is pinned to the version `@raven/app` pins. Read `apps/raven/app/CLAUDE.md`'s "Pins", "Bun's package store" and "Intl and the shared layer": `NODE_PATH` and `REACT_NATIVE_NODE_MODULES_DIR` on the Apple prebuilds, jest letting Babel through `node_modules/.bun`, `^build` before Metro, and `expo.autolinking.exclude` keeping reanimated, worklets and gesture-handler out of the native projects all hold here for the same reasons. A bump moves both apps together.
- **Sign-in and media access are `@raven/native`'s** (`libs/raven/native`), never a copy. `index.ts` imports `@raven/native/polyfills` before `expo-router/entry`. The native modules `@raven/native` uses (`@raven/audio`, `expo-secure-store`, NetInfo) are autolinked through it.
- **The build number and the variant** come from `@raven/native/headless` (`buildNumberOf`, `isDevelopmentVariant`), as the app's do: `GITHUB_RUN_NUMBER`, else 1, and `APP_VARIANT=development` for plain http to a LAN server (`NSAllowsLocalNetworking`, and Android's cleartext through `plugins/withCleartextTraffic.ts`).
- **No TV.** Wren has no `@react-native-tvos/config-tv`, no `EXPO_TV` and nothing from `@raven/app`'s layouts. Its colours come from `@raven/ui/designTokens`; the splash and Android's window are the default theme's `--color-night`.
- **Background audio.** `UIBackgroundModes` holds `audio`, and Android asks for `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, for `@raven/audio`'s media service.
- **Media3** is pinned to exactly 1.8.0 in `libs/raven/audio/android/build.gradle`: `react-native-video` 6.19.3's (`RNVideo_media3Version`), so the workspace builds against one Media3; a bump of either moves both. `@raven/audio`'s README says how its Android side works.

## Running it

- `bunx nx run @raven/music:dev:ios` builds the development variant and runs it on the `raven-phone` simulator against Metro; `dev:android` runs it on the connected device or emulator.
- `build:ios` and `build:android` make the release builds, each running its `prebuild:*` first. `ios/`, `android/` and `build/` are generated and gitignored: change `app.config.ts` or a plugin, never the native projects.
- `test` runs the bun tests (`*.test.ts`); `test:screens` the jest-expo render tests (`*.render.test.tsx`), as in the app. `app.config.ts` is imported by its test through the package's `#app-config` import.
- The native targets and `e2e` need a Mac with Xcode or the Android SDK, so `verify` and `affected` leave them out, as they do the app's.
