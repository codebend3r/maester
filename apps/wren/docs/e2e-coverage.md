# Wren's end to end coverage, app by app

Which features each Wren app's end to end suite exercises, so the gaps show at a glance. A row is a feature of Wren's; a column is one of the apps Wren ships as. raven's video apps have a table of their own, [raven's end to end coverage](../../raven/docs/e2e-coverage.md). It lists what the suites run, not what unit tests cover.

Read on 2026-11-26 from the suites themselves. A new end to end test, or a new Wren app, changes this table: update it in the same change.

| Mark | Meaning |
| :-: | --- |
| ✅ | The app's suite tests it |
| ⚠️ n | Tested with a caveat: note n under the table |
| ❌ | The app has the feature, or should, and no end to end test covers it |
| ➖ | Does not apply to that app |

## The suites

Every suite opens on `@raven/server`'s `serve:fixture`, whose open music library holds one album, Morning Chorus by The Fixture Birds, three twenty second tracks (First Light, Dawn Song, Open Sky). Accounts are off there, so every app opens with no sign-in.

| App | Suite | Driven by | Runs in CI, on main once a pull request merges |
| --- | --- | --- | --- |
| Web | `apps/wren/wren-web/e2e` | Playwright in Google Chrome, wide and at phone width | 🎵 E2E Wren web |
| iPhone | `apps/wren/wren-app/e2e` | Maestro on an iPhone simulator | 🎵 E2E Wren iPhone |
| iPad | None | | The iPhone flows never run on an iPad simulator |
| Android phone | None | | 🎵 Build Wren Android builds the APK only |
| Apple TV | `apps/wren/wren-tv/tvos-e2e` | An XCUITest the Siri Remote drives, on an Apple TV simulator | 🎵 E2E Wren Apple TV |
| Android TV | `apps/wren/wren-tv/e2e` | Maestro on the Android TV emulator, by the remote's keys alone | 🎵 E2E Wren Android TV |

## Coverage

| Feature | Web | iPhone | iPad | Android phone | Apple TV | Android TV |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| **Signing in** | | | | | | |
| Sign in with an account | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Sign out | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Open straight onto the server with no account | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| **Home** | | | | | | |
| Home lists the album under Recently added | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| Home's tile opens the album | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Sort Home's albums by Date added or Latest released | ⚠️ 1 | ❌ | ❌ | ❌ | ❌ | ✅ |
| Shuffle all | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Continue listening resumes the queue | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Library** | | | | | | |
| Library lists its categories with what each holds | ✅ | ⚠️ 2 | ❌ | ❌ | ❌ | ❌ |
| Albums opens the album's page | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| An album's page lists its tracks in order under its artist | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Artists opens the artist, whose page leads to the album | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Songs lists every song, and its search box narrows them | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| A list's sort and cover size | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Unmatched albums, In progress and Recently finished | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Back from an album to Albums, and from Albums to Library | ❌ | ✅ | ❌ | ❌ | ❌ | ⚠️ 8 |
| **Favourites and playlists** | | | | | | |
| Like a song, find it under Favourites, and take it off | ⚠️ 3 | ❌ | ❌ | ❌ | ❌ | ❌ |
| Like an album, find it under Favourites, and take it off | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Follow an artist | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Make a playlist and add a song to it from the song's menu | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Search** | | | | | | |
| Find a song and play it | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Find the album under the Albums filter and open it | ✅ | ❌ | ❌ | ❌ | ❌ | ⚠️ 9 |
| A search that finds nothing says so, and Clear search goes back to Browse | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Recent searches | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Playing** | | | | | | |
| Play the album from its page | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| The track is heard: the audio's position moves on | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Play from the track pressed, the rest of the album after it | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Next moves to the following track | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Previous goes back a track | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Pause | ✅ | ✅ | ❌ | ❌ | ⚠️ 10 | ⚠️ 10 |
| Mute and unmute | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Scrub, shuffle and repeat | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| The bar opens Now Playing, and Close or Escape puts it away | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Up next: remove a song, and Clear empties it | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Up next: move a song up or down | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Lyrics | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| A song's menu: Play next and Add to queue | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Settings** | | | | | | |
| Pick a theme, and it is still worn after a reload or relaunch | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Name the server, and the status says the name | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Pick the music library Home, Search and the collection show | ⚠️ 4 | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Downloads and offline** | | | | | | |
| Download an album and find it under Downloads | ➖ | ✅ | ❌ | ❌ | ➖ | ➖ |
| Remove a download, or all of them | ➖ | ❌ | ❌ | ❌ | ➖ | ➖ |
| Play a download with no server or network | ➖ | ❌ | ❌ | ❌ | ➖ | ➖ |
| A storage limit holds a download back | ➖ | ❌ | ❌ | ❌ | ➖ | ➖ |
| **Layout** | | | | | | |
| The tab bar opens each of the four tabs | ✅ | ⚠️ 5 | ➖ | ❌ | ➖ | ➖ |
| The mini player's Next, and the mini player opening Now Playing | ✅ | ⚠️ 6 | ➖ | ❌ | ➖ | ➖ |
| The sidebar opens each place | ✅ | ➖ | ❌ | ➖ | ⚠️ 11 | ⚠️ 11 |
| B folds the sidebar to its icons, kept across a reload | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| An address that leads nowhere goes Home | ⚠️ 7 | ➖ | ➖ | ➖ | ➖ | ➖ |
| **In the car** | | | | | | |
| CarPlay | ➖ | ❌ | ➖ | ➖ | ➖ | ➖ |
| Android Auto | ➖ | ➖ | ➖ | ❌ | ➖ | ➖ |

## Notes

1. The web suite checks that Home opens sorted by Date added; it never picks Latest released.
2. The iPhone flows open Albums by its label, which says what it holds ("Albums, 1"), but assert no category's count.
3. The web suite likes the song with the heart at its row's end, which only the web has; the apps like a song from its menu, which no suite presses.
4. The web suite checks only that the fixture's one music library is picked: with one library there is nothing else to pick.
5. The iPhone flows press only the Library tab.
6. The iPhone flows press the mini player's Next and Pause, and read its label for the track; they never open Now Playing from it.
7. Wren on the web has no page for an address that leads nowhere: it opens Home, and the suite checks that it does. The apps have no addresses to type.
8. The Android TV flow goes Back from Albums to Library; it never opens the album from Albums.
9. The Android TV flow finds the album among a search's results for a word of its title, under All; it never picks the Albums filter.
10. Both TV suites press the remote's play and pause key after playing, and assert nothing of it.
11. The Apple TV test opens Library from the sidebar; the Android TV flows open Library and Search. Neither opens Home or Settings from it.

## The widest gaps

- **Two of Wren's six apps have no suite:** the iPad and Android phones. The iPhone flows never run on an iPad, so the tablet's sidebar and two column Now Playing are never driven.
- **Wren signs in nowhere.** Both suites open on the accountless fixture, so the sign-in page, sign out and a refused account are never driven.
- **The iPhone is tested far less than the web.** It plays, steps, pauses and downloads one album; search, favourites, playlists, Now Playing, Up next and Settings are driven on the web alone, though both apps have them.
- **Downloads are tested once,** on the iPhone: an album downloaded and listed. Removing one, the storage limit and playing offline are untested.
- **Nothing presses a song's menu, the lyrics, scrubbing, shuffle or repeat** in any Wren app.
