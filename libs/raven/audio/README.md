# @raven/audio

raven's music player for iPhones, iPads and Android phones, behind the contract in `src/index.ts`: `AVQueuePlayer` on iOS, with Now Playing and the remote commands through MediaPlayer.framework, and Media3's ExoPlayer on Android, with a `MediaLibrarySession` for the notification and the media buttons. The queue lives in the app's shared store; the native player holds a window of two tracks, the playing one and the next, so a track starts gaplessly in the background, and tells the app when it moved on.

The TVs play music through `react-native-video` and never call this module. The pod still builds for tvOS, since the app's tvOS target autolinks every Apple module, and the native side does nothing until the first `setWindow`. `@raven/app`'s Android autolinking excludes it (`expo.autolinking.android.exclude`), so the Android TV APK holds no media service of this module's.

`setWindow` opens the playing item at `start` seconds (an audiobook's saved spot, 0 for music): the seek waits until the item is ready to play, as AVFoundation requires of a seek with a completion handler, and the state events and Now Playing report that spot until it lands. `setRate` sets how fast every item plays (an audiobook's speed; 1 for music), kept across items and windows, with `MPNowPlayingInfoPropertyPlaybackRate` and the default rate on Now Playing; each item keeps a voice's pitch (`timeDomain`).

The cover the lock screen shows is fetched with no headers, so a library unlocked by the cookie fallback shows none there.

## Android

- **The player lives in a service.** `RavenAudioService`, a `MediaLibraryService` declared in `android/src/main/AndroidManifest.xml` (`foregroundServiceType="mediaPlayback"`), owns the one ExoPlayer and the session, so music plays on in the background. The module binds it with a `MediaController` on the first `setWindow` and drives the player directly, in the same process. Until the service is up, `ServiceGate` holds every call and runs them in order, and each call's promise settles only once it took effect, as on iOS; a call before any window has nothing to act on. When the service goes away, the next `setWindow` binds it again.
- **The window is `AudioWindow`.** It is plain Kotlin, tested on the JVM (`AudioWindowTest`, and `ServiceGateTest` for the calls held while the service starts): it holds the playing item and the next, drops a finished item as the player moves on, sends `advanced` on a transition the player made by itself, and `ended`, with a pause, after the last item. `setWindow` opens the first item at `start` through ExoPlayer's own start position.
- **Each item has its own headers.** Every item gets its own `DefaultHttpDataSource.Factory().setDefaultRequestProperties(headers)`, since items carry different tickets, under a `DefaultDataSource`, which also opens a `file://` track. The title, artist, album, cover and the server's duration go to the session through `MediaMetadata`.
- **The session forwards every command.** The notification's and the media buttons' play, pause, next, previous, seek and stop reach JS as `remote` events, through a `ForwardingSimpleBasePlayer` that does not apply them, since the queue lives in JS. Audio focus and headphones coming out are ExoPlayer's, and their pause reaches JS through `state`.
- **The browse root is `root`**, with no children yet; CarPlay and Android Auto fill it later.
- **Media3 is pinned to 1.8.0**, `react-native-video` 6.19.3's (`RNVideo_media3Version`), so the workspace builds against one Media3; a bump of either moves both.
- **Tests:** in a prebuilt Wren (`bunx nx run @raven/music:prebuild:android`), `./gradlew :raven-audio:testDebugUnitTest` from `apps/raven/music/android`.

The native code builds only inside an Expo prebuild of `@raven/app` or `@raven/music`, which autolinks this package by its `expo-module.config.json`.
