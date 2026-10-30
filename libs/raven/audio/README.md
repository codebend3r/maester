# @raven/audio

raven's music player for iPhones and iPads: `AVQueuePlayer`, with Now Playing and the remote commands through MediaPlayer.framework, behind the contract in `src/index.ts`. The queue lives in the app's shared store; the native player holds a window of two tracks, the playing one and the next, so a track starts gaplessly in the background, and tells the app when it moved on.

The TVs play music through `react-native-video` and never call this module; the app's only Android target is Android TV, so the module has no Android side. The pod still builds for tvOS, since the app's tvOS target autolinks every Apple module, and the native side does nothing until the first `setWindow`.

The cover the lock screen shows is fetched with no headers, so a library unlocked by the cookie fallback shows none there.

The native code builds only inside an Expo prebuild of `@raven/app` (`prebuild:ios`), which autolinks this package by its `expo-module.config.json`.
