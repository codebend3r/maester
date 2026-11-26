# Claude context for Wren on TV

`@wren/tv` is Wren, raven's music app, on Apple TV and Android TV: an Expo app on the `react-native-tvos` fork with `expo-router`, driven by the remote. Its design is `docs/superpowers/specs/2026-11-26-wren-tv-design.md`. The rules that apply to it are in the root `CLAUDE.md` and `apps/raven/CLAUDE.md`; this file holds what only Wren on TV needs.

## One Wren, three codebases

- **A user-facing change lands in every Wren.** Wren for iPhone, iPad and Android (`apps/wren/wren-app`), Wren on the web (`apps/wren/wren-web`) and this app are one app: whatever changes a screen, a word, an order, a state, what a press does or a token in one needs its counterpart in the others in the same change. `.claude/agents/wren-parity.md` and `wren-three-way-parity.md` check it, and read "Differences from the other Wrens" below as the only differences allowed here.
- **Every word, rule and colour comes from `@raven/wren`**: the copy, the counts, the sorts, a list's state and notice, the players' models, the themes (`WREN_THEMES`, `themeFor`) and their palettes (`WREN_PALETTES`, `BRAND`, `ART`, `ON_PICTURE`), and the lockup's drawing (`LOCKUP_DRAWING`, `BRAND_INKS`). A word or a pure rule the TV needs and the library lacks goes there with its test, never here alone.
- **`src/parity.test.ts` fails when the routes differ:** it lists the route files under `app/` and under `apps/wren/wren-app/app` and asserts they are the same set.
- **The session, the server, the routes, the toast and recent searches' stores and the music hooks are the phone's own**, `@raven/wren-native`'s (its `headless` entry for the routes): `useWrenAccount`, `useWren`, `useActiveServer`, `useCovers`, `useAlbumTracks`, `useTrackLike`, `mediaSourcesFor`, `useAddToPlaylist`, `useNowPlaying`, `useResultActions`, `useSearchResults`, `useSignInFlow`, and the listings over the music library picked (`useMusicLibraries`, `useAllAlbums` and the rest), which read the pick from this app's prefs through `configureLibraryChoice`. What is the TV's own is here, the phone's less the downloads: `src/stores/wrenPrefs.ts` and `src/queryClient.ts`; a fix to one of them is made in the phone's too.

## The build

- **Every build is a TV build.** `app.config.ts` hands `@react-native-tvos/config-tv` `isTV: true`, so `prebuild:tvos` (`--platform ios`) makes the Apple TV project and `prebuild:android-tv` the Android TV one with the leanback launcher, whatever `EXPO_TV` says. The bundle id and the Android package are `app.netlify.wren.tv` (`WREN_TV_ID`), so it installs beside raven and beside the phone's Wren; the Xcode workspace and scheme are `Wren`.
- **The pins and the store are `@raven/app`'s**: read `apps/raven/app/CLAUDE.md`'s "Pins", "Bun's package store" and "Intl and the shared layer". Like raven's device app, it keeps reanimated, worklets and gesture-handler out (`expo.autolinking.exclude`), since a TV has no drag.
- **The launcher pictures are `scripts/tv_images.sh`'s** (`bun run images:tv` in this folder), drawn from `apps/wren/wren-app/assets/brand` as every Wren icon is, a Bark bird with a Night eye on the brand's Leaf: Android TV's banner (`assets/images/tv_banner.png`), the Apple TV icon's two parallax layers at each size and the Top Shelf images (`assets/images/tv_apple/`), named in `WREN_TV_IMAGES`.
- **The faces are the phone app's files** (`../wren-app/assets/fonts`, `src/theme/tvFonts.ts`), embedded by `expo-font`; the fonts are an input of the native targets.
- **Music plays through `react-native-video` out of sight** (`src/music/VideoAudioHost.tsx`), as raven's TV app plays it (its own `VideoAudioHost`, which asks for a video's direct source where Wren asks `trackSource`): the shared `useAudioQueue` one track at a time, each from the server's own address by its ticket (`mediaAccessFor`'s `trackSource`), the file itself, or the AAC transcode at 256 kbps where this TV's player cannot decode it (`trackRequestOf`: ALAC on Android TV, Opus in WebM on Apple TV). `@raven/audio` is linked, a dependency of the app's own as in raven's, since `@raven/native` imports it, but never called; raven's `plugins/withoutTvAudioService.ts` takes its media service out of the Android TV manifest.
- **The config plugins and the device scripts are raven's**, used by path, as the phone's iOS deploy uses raven's script: `app.config.ts` runs `apps/raven/app/plugins/withTvRemoteTests.ts` naming the `WrenRemoteTests` target (the Siri Remote's XCUITest, `tvos-e2e/*.swift`) and `withoutTvAudioService.ts`, and the phone's `withCleartextTraffic.ts`; `scripts/build_tvos.sh`, `deploy_tvos.sh` and `deploy_android_tv.sh` set the app's folder, names and id and run raven's script of the same name. All of them are inputs of the native targets (`nativeTv`).

## The remote

- **The focus kit is `src/ui/`:** `Focusable` (every control: a `Pressable` the focus engine reaches, ringed and lifted while the remote is on it, its children a function of the focus where they change with it), `FocusButton`, `ListRow`, `Tile` (an album, an artist or a playlist), `SongRow` (a press plays from it; More beside it, or holding select, opens its menu), `Sheet` (the phone's bottom sheet as a panel in the middle of the TV, a `Modal` that Back and Menu close), `TextField` (the TV's own keyboard), `EmptyState`, `Headers`, `Loading`, `TileGrid`, `QualityChips`, `Equalizer` and `WrenLockup`. A screen builds from it rather than styling its own controls; the first control of each screen takes `hasPreferredFocus`.
- **Sizes are drawn for a 1920 point screen** and scaled to the TV (`src/theme/tvTokens.ts`, `tvSize`): Apple TV's window is 1920 points, so 1, a 1080p Android TV's is 960 dp, so a half. Nothing else holds a size.
- **The shell is the sidebar** (`src/shell/Sidebar.tsx`), the phone's tab bar and mini player at the left edge: the lockup, Home, Library, Search and Settings (`PLACES`), and the song playing, read as the mini player is ("Now Playing: First Light, The Fixture Birds"). It folds to its drawings while the remote is on the page and opens as it comes back. The tabs' layout (`src/shell/WrenTvTabs.tsx`) is the sidebar beside a `Slot`; the pages the stack pushes (an album, an artist, a playlist, a category, Now Playing) cover it, and Back (Menu on Apple TV) pops them.
- **Menu stays the navigator's.** `.oxlintrc.json` refuses `BackHandler` and `TVEventControl`, as raven's device app does: taking tvOS's menu key would keep Home from leaving Wren.
- **The media keys work anywhere** (`src/remote/useMediaKeys.ts`, over `queueActionOf`): play and pause, and the skip keys step through the queue. On Android TV a key counts as it comes up.

## Differences from the other Wrens

Each of these is intended. Anything else that differs is drift.

- **No downloads**, as on the web: no Download button, no Downloads category, shortcut or page (`/collection/downloads` opens Albums), no downloads group, storage or Remove all in Settings, and no "Play your downloads". The quality chips never say Downloaded.
- **No "Streaming on cellular"**, CarPlay or Android Auto: a TV has no mobile network and no car. `useWrenPrefs` keeps the web's values: the theme choice, `homeSort`, `coverSize` and `libraryId`.
- **No volume and no Output on Now Playing.** The TV's own remote sets the volume, and a TV plays through its own speakers.
- **Gestures become controls**, as on the web: Up next moves a song with Move up and Move down and takes it off with Remove; the remote has no drag or swipe.
- **No A to Z rail.** The remote scrolls the artists' grid.
- **Now Playing is the tablet's sideways layout always**: the player beside one pane of Up next and Lyrics.
- **Home's shortcuts are the tablet's less Downloads**: Shuffle all and Playlists, beside Continue listening.
- **The owner's artist background picker is left out**: it is a managing screen, which the TV leaves to the phone and the web.

## Running it

- `bun run wren:tv:dev:tvos` builds the development variant and runs it on the `wren-tv` Apple TV simulator against Metro; `wren:tv:dev:android-tv` on the Android TV emulator or TV adb sees.
- `bun run wren:tv:deploy:tvs` puts the working tree on the real Android TV, then the Apple TV: the `deploy-wren-tv` skill.
- `test` runs the bun tests (`*.test.ts`), `test:screens` the jest-expo render tests (`*.render.test.tsx`); `src/test/jestSetup.ts` swaps `react-native-video` for a stand-in (`src/test/videoMock.ts`) and AsyncStorage for one that keeps nothing, and a screen test mocks `@raven/native` through `src/test/nativeMock.ts`.
- **`e2e/` holds Maestro flows for Android TV**, driven only by the remote's keys (`pressKey: Remote Dpad ...`, `Back`, `Remote Media ...`) and checked by what has the focus, against `@raven/server`'s `serve:fixture` (Morning Chorus by The Fixture Birds). `e2e:android-tv` first runs `adb reverse tcp:8490 tcp:8490`, and drives the emulator `ANDROID_SERIAL` names alone. **The Apple TV's flow is the XCUITest** `tvos-e2e/WrenRemoteFlowTests.swift`, driven by `XCUIRemote`, since Maestro cannot drive tvOS; `e2e:tvos` runs it on the simulator `TVOS_SIMULATOR` names (`wren-tv`). What they cover is `apps/wren/docs/e2e-coverage.md`.
- **`bun run ci:wren:tv:tvos`** and **`bun run ci:wren:tv:android-tv`** run CI's `🎵 Build Wren Apple TV` and `🎵 Build Wren Android TV` jobs and their end to end jobs here, as raven's `ci:app:tvos` and `ci:app:android-tv` do; the Android one shares raven's `raven_tv` AVD.
