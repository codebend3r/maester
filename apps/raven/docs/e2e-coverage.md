# raven's end to end coverage, app by app

Which features each raven app's end to end suite exercises, so the gaps show at a glance. A row is a feature some suite tests; a column is an app. It covers raven's video apps only: Wren, raven's music app, has a table of its own, [Wren's end to end coverage](../../wren/docs/e2e-coverage.md), and sparrow has none. It lists what the suites run, not what unit tests cover.

Read on 2026-11-21 from the suites themselves. A new end to end test, or a new app, changes this table: update it in the same change.

| Mark | Meaning |
| :-: | --- |
| ✅ | The app's suite tests it |
| ⚠️ n | Tested with a caveat: note n under the table |
| ❌ | The app has the feature, or should, and no end to end test covers it |
| ➖ | Does not apply to that app |

## The suites

| App | Suite | Driven by | Runs in CI, on main once a pull request merges |
| --- | --- | --- | --- |
| Web | `apps/raven/web/e2e` | Playwright in Google Chrome, against `@raven/server`'s fixture | 🌐 E2E Raven web |
| Raven macOS | `apps/raven/desktop/e2e` | Playwright driving Electron, against a stand-in server | 🎬 E2E Raven Mac desktop |
| Raven Windows | `apps/raven/desktop/e2e`, but the specs only macOS can run, with `windowsChrome.e2e.ts` | Playwright driving Electron, against a stand-in server | 🎬 E2E Raven Windows desktop |
| iPhone | `apps/raven/app/e2e`, the flows not tagged `dpad` | Maestro on an iPhone simulator | 🎬 E2E Raven iPhone |
| iPad | The iPhone's flows | Maestro on an iPad simulator | 🎬 E2E Raven iPad |
| Android phone | `apps/raven/app/e2e`, the flows tagged `touch` | Maestro on an Android phone emulator | 🎬 E2E Raven Android phone |
| Android TV | `apps/raven/app/e2e`, the flows not tagged `touch` | Maestro on an Android TV emulator, with the remote's keys | 🎬 E2E Raven Android TV |
| Apple TV | `apps/raven/app/tvos-e2e` | XCUITest pressing the Siri Remote | 🎬 E2E Raven Apple TV |

## Coverage

| Feature | Web | Raven macOS | Raven Windows | iPhone | iPad | Android phone | Android TV | Apple TV |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| **Signing in** | | | | | | | | |
| Sign in with an account | ❌ | ⚠️ 1 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Stay signed in across a relaunch | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Open straight onto the server with no account | ❌ | ➖ | ➖ | ✅ | ❌ | ❌ | ✅ | ✅ |
| **Home** | | | | | | | | |
| Home shows a shelf for each library | ✅ | ⚠️ 2 | ❌ | ✅ | ❌ | ❌ | ✅ | ⚠️ 3 |
| Hero steps to the next title and opens it | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Hero's Play plays its title | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| A title played part way appears under Continue watching | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Binge list: add a show, play from its card, take it off | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Side menu lists the app pages | ❌ | ✅ | ❌ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Back returns the focus to the card a page was opened from | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ | ✅ |
| **Browsing** | | | | | | | | |
| A library opens on its grid | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ |
| A library sorts by its own fields | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ⚠️ 4 | ❌ |
| Libraries page lists every library | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| A film's page opens with Play | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ |
| Show to season to episode | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Mark watched and take the mark off | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ |
| Favourite a title and remove it | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Search every library | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Search that finds nothing says so | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Search one library from its own box | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Coming soon: held titles and requesting one | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Settings tabs, and a preference kept across a reload | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| An address that leads nowhere offers the way home | ✅ | ❌ | ❌ | ➖ | ➖ | ➖ | ➖ | ➖ |
| **Video playback** | | | | | | | | |
| Play a film | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ |
| Pause and play | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ⚠️ 5 |
| Skip back and forward ten seconds | ✅ | ✅ | ❌ | ⚠️ 6 | ❌ | ❌ | ⚠️ 7 | ⚠️ 5 |
| Back to the start | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ 5 |
| Resume from where it stopped | ✅ | ⚠️ 8 | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Next video | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Previous video | ✅ | ✅ | ❌ | ⚠️ 9 | ⚠️ 9 | ⚠️ 9 | ⚠️ 9 | ⚠️ 9 |
| Skip intro | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Subtitles on and off | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Switch subtitle track | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Switch audio track | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| A track pick is remembered for the next play | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Switch quality | ✅ | ⚠️ 10 | ⚠️ 10 | ❌ | ❌ | ❌ | ❌ | ❌ |
| Queue menu lists the session and plays a pick | ✅ | ✅ | ❌ | ⚠️ 9 | ⚠️ 9 | ⚠️ 9 | ⚠️ 9 | ⚠️ 9 |
| Autoplay rolls on to the next video at the end | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Autoplay off holds at the end | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Shuffle on and off inside the player | ✅ | ✅ | ❌ | ⚠️ 9 | ⚠️ 9 | ⚠️ 9 | ⚠️ 9 | ⚠️ 9 |
| Video info overlay | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Player keyboard shortcuts | ⚠️ 11 | ✅ | ❌ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Leaving the player returns to the page it was opened from | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ |
| **Music** | | | | | | | | |
| Play a track from its album | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Pause or stop the music | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| The equalizer marks the playing track's playlist row and the mini-player | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/design` shows the equalizer at its three sizes | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| A music library opens on its albums | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Clear the queue from Up next | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Downloads and offline** | | | | | | | | |
| Download a video | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ➖ | ➖ |
| Download a whole season, with the count of what is left | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ➖ | ➖ |
| Pause and resume a download | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ➖ | ➖ |
| Delete a download | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ➖ | ➖ |
| A download survives a reload or relaunch | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ➖ | ➖ |
| Play a download with no server or network | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ➖ | ➖ |
| A position saved offline reaches the server later | ➖ | ✅ | ❌ | ❌ | ❌ | ❌ | ➖ | ➖ |
| A watched download deletes itself | ➖ | ✅ | ❌ | ❌ | ❌ | ❌ | ➖ | ➖ |
| A `raven://download` link from outside starts a download | ➖ | ✅ | ❌ | ➖ | ➖ | ➖ | ➖ | ➖ |
| **Desktop shell** | | | | | | | | |
| Plays through the built-in player when mpv is off | ➖ | ✅ | ❌ | ➖ | ➖ | ➖ | ➖ | ➖ |
| mpv stays responsive, refuses forged commands, quits cleanly | ➖ | ✅ | ❌ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Security baseline: CSP, bridge, Host check, file grants | ➖ | ✅ | ❌ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Release check against GitHub | ➖ | ✅ | ❌ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Logs hold the launch marks and never a secret | ➖ | ✅ | ❌ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Help menu copies diagnostics | ➖ | ✅ | ❌ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Sound output choice kept across a relaunch | ➖ | ✅ | ❌ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Launch time and idle memory budgets | ➖ | ✅ | ❌ | ➖ | ➖ | ➖ | ➖ | ➖ |

## Notes

1. Raven macOS signs in through the web sign-in page against a fake Supabase Auth the suite runs on the loopback, never the real one. Every other suite runs on an accountless fixture and skips sign-in.
2. Raven macOS checks only that Home shows the two libraries' shelves and their first titles, beside the side menu.
3. Apple TV checks only that Home opens with the focus on the hero's Play and that Down reaches the film's card.
4. Android TV asserts that a movie library shows its Sort control; it never changes the sort.
5. Apple TV tests pausing, the ten second skips, resuming and starting over only in `DevicePlaybackTests.swift`, which needs a real Apple TV, a real server and `RAVEN_DEVICE_MEDIA_IDS`. The CI run on the simulator skips it, so CI covers none of them but the resume offer on the film's page.
6. iPhone asserts that the Back 10 seconds and Forward 10 seconds buttons are there once paused; it presses neither.
7. Android TV skips forward only, with the remote's Right while paused, and checks the spot the page then offers to resume from.
8. Raven macOS tests resuming only for a download, after a relaunch. A server title's resume is never checked there.
9. The device app has no Previous that goes to the video before, no Queue menu and no shuffle inside its player yet. Those were added to the web's shared player on 2026-11-21, so here the gap is the feature as well as its test.
10. mpv plays the original file, so Raven offers no other quality. The macOS suite asserts exactly that: the Playback menu names direct play and holds no choice. Raven Windows runs the same spec.
11. The web suite presses only `k` for play and pause and `End` to reach a video's end. Raven macOS also presses the number keys, `?`, `i`, Escape and the arrows.

## The widest gaps

- **Three apps have no suite at all:** Raven Windows, the iPad and Android phones.
- **Sign-in is tested in one place,** Raven macOS, and against a fake Auth. Sign-up, password reset and the pending page are tested nowhere.
- **The player's controls beyond play, pause and skip are web and macOS only.** No device suite touches subtitles, audio tracks, skip intro, next or autoplay.
- **Downloads are untested on every phone and tablet,** though the iPhone, iPad and Android phone apps all download.
- **Raven macOS tests the shell, not the pages.** Search, libraries, favourites, settings, Coming soon and the series pages are never driven inside its window.
- **Music is thin:** the web plays one track and clears the queue, and Raven macOS and the device app play none. No suite here presses Next on a track, makes a playlist or downloads an album; Wren's suites do, in [its own table](../../wren/docs/e2e-coverage.md).
