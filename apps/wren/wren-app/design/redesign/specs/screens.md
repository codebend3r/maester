# Screens

Each screen has a dark and a light PNG in `reference/phone` or `reference/tablet`, and a standalone HTML file in `reference/html` (open in a browser; markup and inline styles are the exact values). Phone frame 390 x 844; tablet frame 1194 x 834 landscape.

Content in the mockups (album titles, counts, timings) is sample data from the current library. Wire everything to real data. Lyrics text in the mockups is placeholder copy.

## Global layout rules
- Safe areas respected; content starts below the status bar (about 54 to 62 top on phone).
- Phone side gutter 20. Tablet content padding 36 top, 40 sides.
- Large titles in Young Serif, left aligned. Pushed screens show a back link ("< Library") in `accentText` above the large title.
- The mini player (phone) and player bar (tablet) appear on every screen once something has played, except Sign in, Now Playing and modal alerts. Lists get bottom padding so the last row clears them.
- Lists scroll under the tab bar. No horizontal scrolling for tabs or segmented controls.

## Phone

| File | Screen | Key contents and states |
|---|---|---|
| P01-SignIn | Sign in | Mark 76 (bark on dark, ink on light), "Welcome to Wren", subtitle, Email and Password fields with icons, show-password toggle, Sign in (52), Forgot password link, server chip "Server: raven · Change", "Part of Maester" footer |
| P02-SignInError | Sign in error | Field-level errors ("Enter your email", "Enter your password") plus an alert banner (`accentSoft`) above the button. Wrong credentials: banner only, "Email or password is incorrect." Server unreachable: banner "Can't reach raven. Check the server address." |
| P03-Home | Home | Header: small mark + "Wren" wordmark text, server status chip. Greeting large title (time of day). Continue listening card (96 art, overline, album, "Artist · Track N of M", play button). Two shortcut cards: Shuffle all (count), Downloads (count). "Recently added" shelf with See all |
| P04-Library | Library | Large title + search icon. Category rows with counts: Playlists, Artists, Albums, Songs, Downloads. "Recently added" 2-column grid below. Replaces the old overflowing tab strip |
| P05-Albums | Albums | Back to Library, large title, search field, count + sort control (Title, Artist, Year, Recently added), 2-column grid |
| P06-Artists | Artists | Same header pattern, artist rows, A to Z index rail on the right edge |
| P07-Songs | Songs | Play and Shuffle buttons, search, count + sort, song rows with art |
| P08-Playlists | Playlists (empty) | "+" in the nav bar, empty state with "New playlist" button. Populated state: 2-column grid of playlist tiles, same as albums |
| P09-Downloads | Downloads | Storage card (used vs limit, quality, Manage link to Settings), Play and Shuffle, downloaded albums with size. Empty state: "Nothing downloaded yet" + "Download an album or playlist from its page." |
| P10-Search | Search (idle) | Large title, search field, Browse tiles (Albums, Artists, Songs, Downloaded), Recent searches with per-item remove and Clear |
| P11-SearchResults | Search results | Focused field with clear and Cancel, filter chips (All, Songs, Albums, Artists), top result card with play, Albums shelf, Artists row (circles). Songs section continues below when scrolled |
| P12-SearchEmpty | No results | Focused field, empty state "No matches for "query"", hint text, Clear search |
| P13-Album | Album | Nav bar with more menu. Art 236, Young Serif title, artist link (`accentText`), "Genre · Year · N songs · duration", Play + Shuffle, then Download / Like / Queue icon buttons with labels. Track list with number, title, downloaded check, duration, more. Downloaded album: Download becomes "Downloaded" (check icon, `accentText`), tapping offers "Remove download". Downloading: circular progress in place of the icon |
| P14-TrackMenu | Track actions | Bottom sheet over the album: header, Play next, Add to queue, Add to playlist..., separator, Like, Download, separator, Go to album, Go to artist |
| P15-AddToPlaylist | Add to playlist | Sheet title "Add to playlist", track subtitle, "New playlist" row (accent), empty message. With playlists: list of playlists (art, name, count), tap adds and shows a toast "Added to <name>" |
| P16-Artist | Artist | Hero 300 tall with artist art (fallback: art colour + shape), fade to `bg`, back and more buttons on dark translucent circles, name in Young Serif 44, counts. Play, Shuffle, Follow. Top songs (3, See all). Albums grid. "Appears on" section below |
| P17-NowPlaying | Now playing | See components.md. Output pill shows server and device |
| P18-Lyrics | Now playing · lyrics | Compact header, synced lines, compact transport |
| P19-Queue | Now playing · up next | Compact header, source line, shuffle/repeat, reorderable rows, compact transport |
| P20-Settings | Settings | Account card (avatar initial, name, email, Sign out). Server group (name, URL, "Connected" status, chevron to edit). Downloads card: Download quality segmented (128 / 256 / 320 kbps), Streaming on cellular segmented (Original / 128 / 256 / 320), Storage limit row (Off, 2, 5, 10, 20 GB in a picker), usage meter. Remove all downloads (danger row). About: Version, Licenses |
| P21-RemoveDownloads | Remove all downloads | Alert dialog over Settings. Title "Remove all downloads?", body "<size> of music will be deleted from this device. You can still stream it whenever raven is reachable.", Cancel + Remove |

## Tablet

Shell for every tablet screen except Sign in: sidebar (left, 256), content area, player bar (bottom, 84). In portrait, collapse the sidebar to a 76 wide icon rail (same items, labels hidden, tooltip on long-press) and keep the player bar.

| File | Screen | Key contents |
|---|---|---|
| T01-SignIn | Sign in | Split: left half always Night (#15201e) with bark lockup, large mark and tagline in Young Serif; right half themed form (max width 400) |
| T02-Home | Home | Greeting, Continue listening card (132 art, Resume) next to three shortcut cards (Shuffle all, Downloads, Playlists), Recently added 6-column grid |
| T03-Albums | Albums | Title with search field and sort button on the right, count, 5-column grid |
| T04-Album | Album | Two columns: left 300 (back link, art, title, artist, meta, Play + Shuffle, icon buttons) and right tracklist with column headers (#, Title, Time). Playing row highlighted with `accentSoft` and the equalizer |
| T05-Artist | Artist | Full-bleed hero 250 with Play/Shuffle/Follow on the right, then Top songs (left) and Albums grid (right) |
| T06-Search | Search results | Large focused field, chips, Songs + Albums (left), Artists (right) |
| T07-NowPlaying | Now playing | Full screen, three columns: player (art 350, title, transport), lyrics (centre), Up next panel (right, `surface`) with output status at the bottom. Sidebar and player bar hidden |
| T08-Settings | Settings | Two columns: Account, Server, About (left); Downloads, Remove all downloads (right) |

## Copy rules
- Sentence case everywhere except the brand name.
- No "0 albums" style counts; drop zero values.
- Durations: "3:36" for tracks, "1 hr 24 min" for albums.
- Server name is the user's configured name (shown as "raven").
- Errors say what happened and what to do next.
