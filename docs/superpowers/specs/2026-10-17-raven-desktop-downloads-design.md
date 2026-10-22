# raven desktop downloads: keep server titles on this computer

> **2026-10-22:** raven player is now the web app in an Electron window. The Downloads page and Settings section are web pages in `apps/raven/web/src/desktop/`; the server is the one fixed server (no "Add the raven server" ask, no server removal), and downloads fetch with the page's account ticket (no cookie path). Where this spec says Home, servers in Settings or a server's session, read the web page and the one fixed server.

Status: shipped, as seven stacked PRs built from `docs/superpowers/plans/2026-10-17-raven-desktop-downloads.md`: #202 (the link), #206 (state, expansion and the ask), #208 (fetching and the Downloads page), #211 (playing and syncing), #214 (auto-delete), #226 (the web button, the e2e suite and these docs) and #238 (the follow-ups: `pickOrigin`, main's constants and the owed fix). "Outcomes", at the end, records where the build changed this spec. This builds on the desktop spec, `2026-10-12-raven-desktop-design.md`, whose P6 slice (server titles) shipped: servers in Settings, the `raven://play` link, a session and an allowlist per server, and mpv reading `/api/media/:id/file` with the server's cookie. It also builds on the direct media spec, `2026-10-16-raven-direct-media-design.md`: a download fetches its bytes from the server's media origins with a media ticket. That spec's server side and the redesign (PR 197, Verdigris) landed on 2026-10-17, so the web app's part targets the redesigned pages. Its client stack (`direct-media-client` and the PRs after it) had not landed, and this stack was built on `main` before it (plan Ruling 1).

## Context

raven player plays a title from a raven server by streaming it. Without the server, on a plane or in a house with no connection to the NAS, there is nothing to play. This lets a viewer keep a copy of a server's titles on the computer the player runs on: a movie, a saga, a show, a season or one episode, with its sidecar subtitles. Kept titles play through the native engine from the local copy, with the same controls and resume as any other title, and what was watched reaches the server once it is reachable again.

The desktop app is the only client this is for. The web app's one part is the way in: a "Download to raven player" button beside Play on the movie, episode, season, show and saga pages, shown while Settings' "Open videos in raven player" is on. The watch page, which offers "Open in raven player", gets none. The server changes nothing.

Decided with the user:

- Desktop only. The web app gains the download action and nothing else; the server is untouched.
- The file saved is the server's original, the same bytes mpv streams today, plus the sidecar subtitles the server serves for it. No smaller copy: the desktop has no transcoder yet.
- What can be downloaded: a movie, a whole saga, a whole show, a season, or a single episode.
- Each download has an option to delete itself once watched. Deletion runs ten minutes after the title counts as watched. If the app is quit before then and opened again more than ten minutes after the watched moment, deletion runs at once on launch; opened sooner, the timer resumes for what is left.
- The app shows how much space the disk has free and how much each downloaded video takes.
- The way in is the web app: a `raven://download` link handed to the desktop app, as "Open in raven player" hands a `raven://play` link today. The desktop app had no library browser in this slice; since 2026-10-22 it is the web app (see the note at the top of the desktop spec), so a download is also started from the app's own title pages, which ask the app directly with no link.
- The bytes come through the media origins and tickets of the direct media spec, as the web player's will, not through the server's cookie; the cookie path stays only as the fallback for a server that advertises no media origin, or none this computer reaches.
- This stack waited for the redesign. It was then built on `main` before the direct media client stack landed, at the user's ask (plan Ruling 1), so the desktop picked a media origin with its own rule until it adopted core's `pickOrigin`, the web player's rule, in the seventh PR.
- History shows a downloaded title's play dated when the server hears of it, not when it was watched. Dated plays would need a server change and are a follow-up.

## Goals

- A title picked in the web app lands on the computer, whole, with its sidecars, and survives a quit, a sleep and a dropped connection mid-download.
- A downloaded title plays with no server at all: no call before, during or after playback blocks it.
- Where you stopped, and that you watched it, reach the server when it is next reachable, in the form the server already understands (progress reports and plays), so Continue watching and the watched marks come out as if it had streamed, and History records the play when the server hears of it.
- The viewer always sees what is on disk, what it costs, what is still coming and what will delete itself.
- Nothing the web page sends names a host, a path or a cookie. Every download is keyed by ids and built in the main process from the server the viewer trusted.

## Non-goals

- Browsing a server's library inside the desktop app. That is D3 and D4 of the desktop spec.
- Downloading anything but the original file: no transcode, no quality picker, no "fit this title in N GB".
- Downloading a local file (one already on this computer) or an item from the web app's own browser.
- Playing a download in the web app or syncing downloads between computers.
- Choosing the folder downloads live in. They sit under the app's data directory, and a later slice may add a picker.
- Marking watched offline through the Watched toggles. Watched follows from playback only, as it does for a streamed title; the toggles stay on the server's pages.

## Anti-goals

Things that would make this a failure even if it technically works:

- A download that deletes itself while it is playing, or deletes an episode the viewer is in the middle of.
- A half-written file that looks finished: a download is "ready" only once every byte the server promised is on disk.
- A download that fills the disk: the app refuses to start one that will not fit, and leaves a reserve.
- Progress that the server never hears of, or hears twice as two plays, or that overwrites a later streamed position with an older offline one (one cross-device race is accepted; see Outcomes).
- A page that can make the main process fetch an arbitrary URL or write an arbitrary path.

## What the viewer sees

### In the web app

On the movie, episode, season, show and saga pages, beside Play, a **Download to raven player** button, shown only when Settings' "Open videos in raven player" is on, as "Open in raven player" is. It hands the browser a `raven://download` link; a browser without the app does nothing or says so, as the play link does today. The watch page gets no button: a title being streamed is downloaded from its own page.

### In raven player

**The ask.** When a download link arrives, the app's trust prompt runs first for a server it does not know, as for a play link. Then main works out what the link names (one file, or every file of a season, show or saga), reads each file's size from the server, and the page shows a dialog:

> Download *The Lord of the Rings* (3 movies, 41.2 GB) from Vhagar?
> 412 GB free on this disk.
> [ ] Delete once watched
> [Cancel] [Download]

The checkbox starts from the last choice made, off the first time. A locked library asks for the PIN first, through the same `UnlockDialog` server titles use; an admin lock asks for the password first, the same way. When the files will not fit, the dialog says so instead of offering Download: "Needs 41.2 GB; 12.0 GB free." When every file is already downloaded or queued, it says "*The Lord of the Rings* is already downloaded." and offers Cancel alone. Download closes the dialog and queues every file; a notice says "Downloading 3 movies from Vhagar" (or "Downloading *The Two Towers* from Vhagar" for one file), and Home's Downloads button shows the work.

**Downloads page.** Reached from a **Downloads** button in Home's header beside Settings, which shows a badge with the number still queued or downloading. The page is a grid:

- A header: Back, the title "Downloads", and a line "34.2 GB of downloads · 412 GB free of 1 TB". A `meter` under it shows the disk, with downloads as the filled part, labelled for assistive tech.
- A list, newest first, one `li` per file. Each row shows the title ("S02E04 Trojan Horse", "The Two Towers (2002)") and, under it, what it belongs to and where it came from ("Severance · Vhagar", "The Lord of the Rings · Vhagar", or the server alone for a movie downloaded by itself), its size, and its state: a `progress` element with "12.1 of 14.8 GB" while downloading, "Waiting" while queued, "Paused" (or why: "Not enough space", "Vhagar locked this library again", "Vhagar could not be reached"), "Failed: <why>" or, once ready, the size alone. A ready row shows a watched bar like Home's recents, and "Deletes in 7 minutes" while the clock runs; a deletion held while the title plays or sits mid-title shows nothing.
- Each row's actions: **Play** (ready only), **Pause** or **Resume** (while queued or downloading, or paused), **Retry** (failed), a **Delete once watched** switch, and **Delete**, which asks once ("Delete *The Two Towers*? 14.8 GB will be freed.", the bytes on disk for a file not yet whole).
- **Pause all** in the header while anything is queued or downloading, and **Resume all** beside it while anything waits paused.
- An empty state: "Nothing downloaded yet. Open a title in raven on the web and choose Download to raven player."

Rows of one show or saga are not grouped in this slice; the second line of each row says what it belongs to, and the list sorts a group's files together, in play order, under the newest of them.

**Home.** A downloaded title opened from Downloads joins the recents as any opened file does, with "Downloaded from Vhagar" as where it came from. A download that has been deleted leaves the recents.

**Settings.** A **Downloads** section: the default for "Delete once watched", a **Delete all downloads** button with a confirmation, and the line "Downloads are kept in raven player's data folder" with a **Show in Finder** button. Removing a server from Settings deletes its downloads too; the removal confirmation says so when there are any.

**While playing a download.** The player is the native engine over the local file, exactly as for a dropped file: resume, track picks, next in queue. The header says "Downloaded from Vhagar" beside the playback mode. The up-next list is the rest of the download's group in play order (the next episode, the next movie of the saga), ready ones only. Back returns Home. No "Open in browser" or server-side action shows.

**Notices.** "Downloaded *The Two Towers*" when a file finishes, on any page (Downloads included; see Outcomes); "Deleted *The Two Towers* after watching" when the clock runs out; "Could not download *The Two Towers*: <why>" on failure.

## The link

In `@raven/core`'s `playLink.ts`, beside `playLinkFor`:

```
raven://download?server=<origin>&media=<id>
raven://download?server=<origin>&item=<id>
raven://download?server=<origin>&saga=<libraryId>:<tmdbId>
```

Exactly one of `media`, `item` or `saga`. `media` is a file (the movie page's or episode page's Play target, `primary` or the best version). `item` is a show or a season, by its item id; an episode or movie item is also accepted and resolves to its best file. `saga` names the library's saga by the TMDB collection id, since a saga has no id of its own (`GET /api/libraries/:id/sagas` lists them by `tmdbId`).

`downloadLinkFor` builds it in core, `readDownloadLink` in `apps/raven/desktop/src/shared/playLink.ts` reads it with the same strictness as `readPlayLink`: a bare http or https origin, ids as `isMediaId` accepts them, no unknown or repeated keys, no hash, a 4096-character cap. The web pages call `downloadLinkFor` with `window.location.origin`, as the watch page does for play links. `open-url` in main already reads every `raven://` link through `LinkOpener.open`; it now reads a download link too, trusts its server the same way (the native "Add the raven server at ...?" prompt), and answers `{ type: 'downloadAsk', ask }` (below) instead of `playServer`.

## Processes and files

Everything lives in the desktop app's main process, beside the servers, with the page holding ids and views only.

```
apps/raven/desktop/src/
  shared/
    playLink.ts            readDownloadLink, DownloadRequest
    protocol.ts            the new requests, replies and events, and the views' guards
  main/
    downloads/
      downloadState.ts     the persisted shape, its guard and the pure transitions
      downloadStore.ts     downloads.json through the JsonStore
      expand.ts            a link's target to the list of files to fetch
      asks.ts              an ask: expanded, held for the page's answer, then queued
      mediaAccess.ts       a server's media origins, their probe, the pick and the tickets
      fetchFile.ts         one file, with ranges, to disk
      downloadQueue.ts     the queue: what runs, pausing, retrying, outages, sleep
      sweep.ts             the launch sweep of unnamed folders and servers no longer kept
      space.ts             free space, the reserve and the path builders
      playback.ts          a download played as a local file: grants, positions, playing
      autoDelete.ts        the ten-minute clock
      sync.ts              pending plays and positions, and what deleted downloads owe, to the server
      downloadMessages.ts  the refusals, notices and row words
      downloadService.ts   the page's requests, wired from the above
  renderer/
    DownloadsPage/         the page and its rows
    Shell/DownloadDialog   the ask
    SettingsPage/Downloads the section
    desktop/downloadsApi   the downloads and space queries, and the event that updates them
```

Files on disk, under `userData`:

```
downloads/
  <serverId>/
    <mediaId>/
      video.<container>          the file, once whole
      video.<container>.part     while downloading
      subtitles/<trackId>.vtt    each sidecar
downloads.json                   the state, beside player-state.json
```

The file is named `video.<container>` from `MediaItem.container`, never from the server's `fileName`, so nothing from the server reaches a path; the path builders in `space.ts` refuse a server id, media id, container or track id that does not pass its guard. The title lives in the state and in the page. One folder per file also keeps "next in folder" (`grantNext`) from treating two downloads as siblings; the queue for a download comes from its group instead.

## State

`downloads.json`, version 1, read once at launch through `loadJson` with a guard built from core's combinators (a bad file is kept aside as `.corrupt-<time>` and the app starts with none, as the others do, and that launch's sweep keeps every folder of the servers it keeps), written through the same debounced `JsonStore` as `player-state.json`, flushed on `before-quit`.

```ts
type DownloadEntry = {
  downloadId: string            // opaque, the only handle the page holds
  serverId: string
  mediaId: number
  label: string                 // "The Two Towers (2002)", "S02E04 Trojan Horse": core's mediaLabel, or the episode's code and title
  group: {
    kind: 'movie' | 'episode' | 'season' | 'show' | 'saga'
    key: string                 // the group on its server: "show:<itemId>", "saga:<libraryId>:<tmdbId>", "movie:<mediaId>"
    title: string               // "The Lord of the Rings", "Severance"
    order: number               // play order within the group: season * 10000 + episode, or the saga's index
  }
  container: string
  size: number                  // what the server said; ready means this many bytes on disk
  duration: number | null
  watchedPercent: number        // the library's Watched at when queued
  sidecars: { trackId: string; title: string; language: string }[]
  status:
    | { kind: 'queued' }
    | { kind: 'downloading'; bytes: number }
    | { kind: 'paused'; bytes: number; reason: 'viewer' | 'noSpace' | 'relocked' | 'unreachable' }
    | {
        kind: 'failed'
        bytes: number
        reason: 'noSpace' | 'changed' | 'unauthorized' | 'unreachable' | 'gone' | 'other'
        message: string         // the words of an `other` failure; '' for the rest
      }
    | { kind: 'ready' }
  autoDelete: boolean
  watchedAt: number | null      // when playback first reached watchedPercent, or when Delete once watched was switched on after that
  serverPosition: number        // the server's resume spot at confirm; 0 once a position is noted here
  pending: Pending              // what the server has not heard yet
  createdAt: number
}

type Pending = {
  play: boolean
  position: number | null       // the last position
  furthest: number | null       // the furthest position since the last send
  at: number                    // when it was last noted
}

type DownloadsState = {
  version: 1
  entries: DownloadEntry[]
  autoDeleteDefault: boolean
  owed: { serverId: string; mediaId: number; pending: Pending }[]  // what deleted downloads still owe their servers
}
```

A status keeps a reason, not words: the page's words are built from it when the page reads the list, with the server's name as it is then, so renaming a server changes nothing stored. Only an `other` failure keeps words of its own. `bytes` is for the views: a resume reads the `.part`'s size on disk, never this.

Progress positions for a download are kept where every local file's are: `player-state.json`'s `resume` list, by path. `pending.position` and `pending.furthest` hold only what the server still needs to hear, and `owed` what a deleted download still owed it (Reaching the server).

`downloadState.ts` holds the transitions as pure functions over the state, with tests: `queue`, `start`, `advance`, `pause`, `pauseServer`, `pauseEverything`, `resume`, `fail`, `finish`, `remove`, `removeAll`, `removeServer`, `setSidecars`, `setAutoDelete`, `setAutoDeleteDefault`, `noteWatched`, `forgetServerPosition`, `notePending`, `clearPending`, `clearOwed`, `dropOwed`, and `sortDownloads` for the list's order. A transition on an unknown id returns the state unchanged.

## Expanding a link

`expand.ts` turns a `DownloadRequest` into the files to fetch. Five reads join the allowlist in `allowlist.ts`, each a `GET` main makes on its own: three for the expansion, which the page may also make, and two for fetching (below), which `isPageCall` keeps to main, so the page never reads a ticket or an origin. `getSagas` answers every saga of the library with a whole `MediaItem` per movie, so its reply may run to `MAX_SAGAS_REPLY_CHARS` (8 MiB); every other call keeps the 1 MiB `MAX_REPLY_CHARS`.

| Call | Path | For |
| --- | --- | --- |
| `getItem` | `/api/items/:id` | a show's seasons, a season's episodes, an episode's or movie's versions |
| `getLibrary` | `/api/libraries/:id` | the library's `watchedPercent` and name |
| `getSagas` | `/api/libraries/:id/sagas` | the saga's movies |
| `getMediaOrigins` | `/api/media-origins` | the origins the bytes may come from |
| `getMediaTicket` | `/api/media/:id/ticket` | the ticket that opens one file on such an origin |

- `media`: `getMedia` for the file, then `getLibrary` for its `watchedPercent`.
- `item` that is a show: `getItem(show)` gives its seasons; `getItem(season)` for each, in order, gives its episodes; each episode's `primary` is the file. A season: the same from the season. An episode or a movie: its `versions[0]` (best first).
- `saga`: `getSagas(libraryId)`, the saga whose `tmdbId` matches, its `media` in order.

Each file arrives as a `MediaItem`, which carries `size`, `container`, `duration` and `libraryId`. Both episodes of a two-episode file name it as their `primary`, so the files are kept once per media id, as the first, before the cap and the skip. An episode, a season and a show all take the group key `show:<itemId>` of their show (`item:<itemId>` for one the server places under no show), so an episode downloaded alone sorts with its season downloaded later, and two shows of one name stay apart. The group's `watchedPercent` is read once per library. A file already downloaded or in the queue is skipped, so downloading a show after one of its episodes adds the rest. The expansion is capped at `DOWNLOAD_MAX_FILES = 500` files in one ask; past it the ask is refused with "That is more than raven player downloads at once." A locked answer (`LOCKED_STATUS` in `@raven/core`, 423) from any read opens `UnlockDialog`, a `404` with the admin lock on asks for the admin password, as `ServerPage` does today; after unlocking, the expansion runs again. `GET /api/libraries/:id` is public, so `watchedPercent` is readable before the unlock.

The expansion's answer is the ask the dialog shows:

```ts
type DownloadAsk = {
  askId: string                  // main holds the expanded files under it until answered, 10 minutes at most
  serverId: string               // opaque; the dialog unlocks the server by it
  serverName: string
  autoDelete: boolean            // the default: the last choice made
  status:
    | {
        kind: 'ready'
        title: string            // the saga's or show's name, or the file's label
        downloadKind: 'movie' | 'episode' | 'season' | 'show' | 'saga'
        files: number            // the files not already in the downloads list, whatever their state
        bytes: number
        free: number
        fits: boolean            // counts what queued and downloading files still need too
      }
    | { kind: 'locked' }         // a read answered LOCKED_STATUS: the dialog asks for the PIN
    | { kind: 'hidden' }         // a 404 with the admin lock on: the dialog asks for the admin password
}
```

The page answers `{ type: 'confirmDownload', askId, autoDelete }` or `{ type: 'declineDownload', askId }`, or, after unlocking, `{ type: 'retryDownloadAsk', askId }`, which expands the link again under the same `askId` and answers a fresh ask. Confirm records the checkbox as the new default. Main never queues on the link alone: nothing is queued or fetched before the viewer says Download (reading free space does create the empty `downloads` folder; see Outcomes).

## Space

`space.ts` reads `fs.promises.statfs` on the downloads folder, creating it first: free is `bavail * bsize`, total is `blocks * bsize`. The reserve is `SPACE_RESERVE_BYTES = 2 GiB`: an ask fits when `bytes + reserve <= free`, where `bytes` counts the ask's files not yet on disk plus what the queued and downloading files still need. The queue checks again before each file starts, since the disk may have filled since the ask: the file needs its size less what its `.part` already holds, against free space less what the other running files still need. One that no longer fits fails with "Not enough space" and the queued files of its group wait, paused, with the same message; Retry succeeds once room for the rest is freed. An `ENOSPC` mid-file fails the file the same way, keeping its `.part` for a resume. The Downloads page reads free, total and the sum of ready and partial bytes through `{ type: 'readSpace' }`, refreshed each time the page opens and when a file finishes or is deleted.

## Fetching a file

`fetchFile.ts` fetches one URL into one `.part` through a streaming fetch main builds for the access it has, both with `redirect: 'error'` and `cache: 'no-store'`: on the cookie path, the server's own session's `fetch` with its cookies, as `serverCalls` uses; on a media origin, `net.fetch` with `credentials: 'omit'`, so no session's cookie rides along. Where the bytes come from follows the direct media spec, through `mediaAccess.ts`:

**The origin.** The first file of a server to start reads `getMediaOrigins` (through the stored origin with the session's cookies, as every allowlisted call goes), keeps only plain http or https origins, cut to scheme, host and port, probes each at once with `GET {origin}/api/media-origins/ping?bytes=262144` (`MEDIA_PROBE_BYTES` in core; `PROBE_TIMEOUT_MS`, 2 s, each, through `net.fetch` with no cookie and no redirect), and picks with core's `pickOrigin`, as the web player does. Each probe is timed over its whole body, as `@raven/ui`'s `probeOrigin` times it: the first byte from the call, then the body's bytes per second. A probe that fails, answers other than 2xx, ends short or outlasts the timeout is left out. `pickOrigin` scores each by bytes per second over the whole body, first byte included, keeps those within 20% of the best, and takes the nearest kind (`lan`, then `tailnet`, then `public`), then the quickest first byte, then the first listed; none scoring above zero is the cookie path. The pick is held in memory per server, shared by files that ask at once, never persisted, and forgotten when a fetch fails to connect, stalls or meets a 5xx, when the server is removed, and on a wake from sleep, so the next file picks again. A server that lists no origin, or whose origins all fail the probe, falls back to the stored origin: the fetch then goes to `${server.origin}/api/media/...` in the server's session, with its `raven_unlock` and `raven_admin` cookies, exactly as mpv streams today.

**The ticket.** On a media origin each file reads its own ticket: `getMediaTicket` (through the stored origin, with the cookies, so a locked library answers `LOCKED_STATUS` here) gives `{ ticket, expiresAt }`, and the URL is `${origin.url}/api/media/${mediaId}/file?t=${ticket}`, a sidecar's `${origin.url}/api/media/${mediaId}/subtitles/${trackId}?t=${ticket}`, with the track id checked against the server's `external-N` naming as the sources do. Main builds every URL itself; the page never sees a ticket or an origin. A ticket lasts six hours (`MEDIA_TICKET_SECONDS`) and a large file may outlast it, so the queue renews it by raven player's own clock: `TICKET_RENEW_MS` (5 h 50 m, six hours less `MEDIA_TICKET_REFRESH_SECONDS`) after it read the ticket, it aborts the fetch, reads a new ticket and resumes with a range request from the bytes on disk, as the web player renews its own. `expiresAt`, which the server issues in epoch milliseconds, is not read for timing, so a clock that differs from the server's changes nothing. A `401` or `423` from the fetch reads a new ticket once per ticket and resumes the same way; a second `401` fails the file, a second `423` pauses the server's files as relocked (below). A ticket read that answers `404` fails the file as gone, and a 5xx as unreachable. A ticket lives in memory only: never in `downloads.json`, never in a log line.

- A fresh file writes to `video.<container>.part`. A resumed one sends `Range: bytes=<done>-`, `<done>` being the `.part`'s size on disk, and expects `206` with a `content-range` that starts at `<done>`; a `200`, or a `content-range` that starts elsewhere, empties the `.part` and starts over from byte 0, once. The server's `accept-ranges: bytes` route serves exactly this. A `416` (the server's file is now shorter than the bytes on disk) empties the `.part` and fails with "The file changed on the server".
- Bytes are appended as they arrive; every `PROGRESS_STEP_BYTES = 8 MiB`, or every second, whichever is later, the entry's `bytes` advances and the page hears a `downloads` event (below). A pause, a quit or a sleep records the bytes on disk in the entry before it lets go, and the `.part` is synced to disk before it closes.
- No answer, or no new bytes, for `DOWNLOAD_STALL_MS = 30 s` fails the file as unreachable. A failure keeps the `.part`; Retry and Resume continue from it.
- When the stream ends, the `.part` must be exactly `size` bytes; a body longer than `size`, or one that ends short, fails with "The file changed on the server" and empties the `.part`. Then the sidecars: `getTracks` lists the file's external subtitle tracks, each is fetched whole (16 MiB at most; a failed one is logged and skipped, as a late track list is today), and the `.part` is renamed into place. Only then is the entry `ready`, and a notice goes out. A file a previous run left `downloading` whose video is already whole finishes without a fetch.
- Two files download at once (`DOWNLOAD_CONCURRENCY = 2`), in queue order, files a previous run left downloading first; the rest wait. A server that answers `LOCKED_STATUS` mid-queue, to a ticket read or twice to a fetch (relocked: the PIN cookie lasts twelve hours and dies with the server process), pauses every file of that server, running ones too, with "Vhagar locked this library again"; Resume on any of them runs the unlock flow and requeues them all.
- A file that cannot reach its server (a ticket read or a fetch that fails to connect, a stall, a 5xx from a proxy in front of a restarting server) fails with "Vhagar could not be reached", and the server's other queued and downloading files pause with the same words, so an outage costs one failure rather than the whole queue. They are requeued on their own at launch, after a wake from sleep, and every `OUTAGE_RETRY_MS = 5 min` while any waits; Pause all stops that.
- A sleep (`powerMonitor`'s `suspend`) stops every fetch and leaves its file downloading; the wake waits `RESUME_SETTLE_MS = 5 s` for the network, then starts them again.
- A `404` from the file fails it as gone ("That title is not on Vhagar any more."); any other status fails it with "Vhagar answered <status>".

A file is identified to the server only by its id. If the server's title for that id has changed (another file at the same id after a rescan), the size check catches a different length; a same-length swap is accepted, as it would be for a stream.

## Playing a download

The page asks `{ type: 'openDownload', downloadId }`. Main grants the file's path (`grant(path)`, the one way in for every local file), builds the queue from the group's other ready entries in `order` after this one, and answers `{ type: 'play', target: { fileId, queue } }`, so the renderer's `PlayRoute` plays it as it plays any local file. `describeFile` answers a `LocalFile` whose `folder` reads "Downloaded from Vhagar" ("Downloaded" once raven player no longer keeps the server) and whose `isDownload` is true, so the player's header (a context line in `@raven/ui`'s `PlayerTitle`, beside the playback mode) and Home's recents say where it came from. When the queue has run out (a download opened from Home's recents, or past `MAX_QUEUE`), Next asks for the group's next ready download before the next file in the folder. A download with no local resume spot opens at `serverPosition`, where the server had it when the download was confirmed. File > Open Recent leaves downloads out; Home's recents keep them.

**Sidecars.** A file `LoadTarget` carries no sidecars today: `sub-add` runs only for a `ServerTarget`. The file target gains an optional `sidecars` list of local paths with their titles and languages, which `resolveSourceWith` fills for a grant that belongs to a download (from the entry's `sidecars` and the `subtitles/` folder) and leaves empty for every other file, and `playerService` runs `sub-add` for a file target's sidecars as it does for a server's. mpv's own auto-load is not relied on: it only finds same-stem files beside the video, and two tracks of one language would collide there. `test:native` gains one case, a local file with one sidecar. (My call; the reviewer raised it.)

Main remembers which download a granted file is the video of (`playback.ts`: learnt when `openDownload` grants it, or found by its path for a file granted another way, from Home's recents or a queue), so:

- `savePosition` for such a file saves the resume spot as for any local file, then also records `pending.position`, raises `pending.furthest`, sets `serverPosition` to 0, and checks the watched rule: `position / duration >= watchedPercent / 100` sets `watchedAt` when it is null. `duration` is the player's reported length, falling back to the entry's. Reaching `END_MARGIN_S` from the end clears the local resume spot as it does for files; `watchedAt` is what the delete clock reads, so a title that ends is watched by either rule. A download's row and recent read whole once `watchedAt` is set.
- The first `savePosition` after the page opens the file (`describeFile`, which the page calls for each file it plays) sets `pending.play`, so the server records the play once, as `recordPlay` does for a stream; two plays before a send are one, since `pending.play` is a flag. The page saves no position for a file it leaves before playback starts, so a download opened and left at once is no play.

Nothing in playback waits on the server.

## Reaching the server

`sync.ts` sends what is pending through the allowlisted calls that exist, in this order: `recordPlay` (`POST /api/media/:id/plays`) when `pending.play`; then `saveProgress` (`PUT /api/media/:id/progress`) with `pending.furthest` when it lies past the last position; then `saveProgress` with `pending.position`, the last. The server keeps how far a play got as the most it hears and the resume spot as the last, so a viewer who watched to the end and scrubbed back keeps both the watched mark and where they stopped. The server's `report()` already treats a position past Watched at as a watched play and clears the server's resume spot, so no new server route is needed and the marks come out right.

When it runs: `SYNC_DEBOUNCE_MS = 2 s` after a position is noted for a download (a timer already running is not pushed back, so a playing download reports as a stream would), and for every download and owed item at launch, whenever the page lists the downloads (Home, Downloads and Settings each do as they open), and every `SYNC_RETRY_MS = 5 min` while anything is pending (`RAVEN_DESKTOP_SYNC_RETRY_MS` shortens it in an unpackaged build, for e2e). A run over the list sends each server's items one at a time, in `pending.at` order, oldest first, so each report replaces the one before as it did when made; servers run side by side. A Delete or Delete all waits up to `SYNC_DELETE_WAIT_MS = 2 s` for its sync, then deletes either way.

What an answer leaves: a call the server takes (a 2xx) clears what it carried, compared first, so `play` clears only when the send carried it and `position` and `furthest` only if they still equal what was sent; a play flagged or a position saved during the call is not lost. A call that cannot reach the server leaves everything pending, ends that server's round, and holds the server: its downloads' saves no longer send on their own and wait for the next run over the list, until a call the server takes. A `403` or `404` leaves a download's pending and is logged once (a title gone from the server never takes it); any other answer leaves it too, and a library locked again (`423`) hears it after the next unlock. Delivery is at least once: a play whose answer was lost stays pending and goes again, which the server folds into the same play within its half-hour sitting.

**What a deleted download owed.** Deleting a download, by Delete, Delete all or the auto-delete, moves what it still owes into the top-level `owed` list of `downloads.json` in the same change (two records of one title merge: a play either owes, the newer last position, the furthest of both). The sync sends `owed` as it does the entries, so a title deleted offline still reaches the server once the server is reachable. An owed item goes once the server has taken all of it, or answers `403` or `404`. Removing a server drops its entries and its owed items, since no call can reach it any more; the launch sweep counts as removing a server for the entries and owed items of servers raven player no longer keeps.

An older offline position does not overwrite a newer one made on this computer, because each server hears this computer's reports in the order they were made. One race is accepted: an offline position synced after a later one streamed on another device moves the server's resume spot back (Outcomes).

## Auto-delete

`autoDelete.ts` keeps one clock per ready entry whose `autoDelete` is on and `watchedAt` is set, through the injected `Timers`, due at `watchedAt + AUTO_DELETE_DELAY_MS` (ten minutes), or at once when that is already past; a wait longer than a timer holds is armed in steps. The clocks are built at launch once the first page has said `ready`, so a deletion due at launch sends its notice to a page that listens; a clock starts when a noted position sets `watchedAt` and when the switch is turned on, stops when the switch is turned off or the entry is deleted, and is armed again from its stored time after a wake from sleep, since a timer stands still while the Mac sleeps. Switching "Delete once watched" on for a title already watched moves its `watchedAt` to that moment, so the ten minutes count from the switch, survive a restart, and the switch never deletes at once (my call).

When a clock runs out, the deletion is held while the download is playing, or while its file has a local resume spot short of the library's Watched at: `watchedAt` is the first time playback reached it and never moves back, so a viewer who scrubbed back from the end is still in the middle of the title. A held deletion is tried again whenever the player leaves a download and whenever a position is noted for it, and runs once neither holds. Otherwise the deletion goes through the service's removal: it waits up to `SYNC_DELETE_WAIT_MS` (2 s) for the server to hear what was watched, then looks again, since the viewer may have opened the file or switched the option off meanwhile, and keeps the download, its clock held or stopped, when it now plays, sits mid-title or is no longer due. The removal removes the entry's folder, drops its recent and its resume spot, moves what it still owes the server to `owed`, and sends "Deleted <title> after watching". A folder that will not go is logged, and the next launch's sweep removes it. Deleting never touches the `.part` of another entry and never runs for an entry that is not `ready`.

"Playing" comes from the page and the engine both. `describeFile`, which the play page calls for each file it opens, puts the page on that file; the page sends `{ type: 'playbackLeft', fileId }` as it unmounts, which takes it off that file if it is still the page's, and a page's `ready` (a new page or a reload) puts it on none. The native engine's resolved source is the second signal: a file source puts the engine on it, and a server title or the player hiding for Home puts it on none. A download plays while either is on it, so an engine stop never clears what the page still plays, and a download the html engine plays, which main never hears, still counts.

## Protocol

Added to `protocol.ts`, each guarded with core's combinators as the rest are:

Requests from the page: `confirmDownload`, `declineDownload`, `retryDownloadAsk`, `listDownloads`, `openDownload`, `pauseDownload`, `resumeDownload`, `retryDownload`, `deleteDownload`, `setDownloadAutoDelete`, `pauseAllDownloads`, `resumeAllDownloads`, `deleteAllDownloads`, `readSpace`, `setDownloadDefaults`, `showDownloadsFolder`, and `playbackLeft`, which the play page sends as it leaves a file (Auto-delete). None carries more than opaque ids (`downloadId`, `askId`, `fileId`, each an `isOpaqueId`) and a boolean.

Replies: `downloadAsk` (the `DownloadAsk`), `downloads` (the list of `DownloadView`, with `autoDeleteDefault`), `space` (`{ free, total, used }`), and the existing `play`, `done` and `refused`.

Events main pushes: `downloadAsk` when a link arrives (the Shell shows the dialog, as it shows `OpenLinkDialog` for `openLink`), `downloads` with the full list on every change (at most four a second), and the existing `notice`. The Downloads page holds the list in a TanStack query keyed `['desktop', 'downloads']` that the event updates, so a page opened mid-download is right at once; an event that drops a row also refreshes Home's recents, and one that finishes or drops a row reads the disk again.

`DownloadView` is a download as the page shows it: `downloadId`, `serverId` (opaque, for the unlock and Settings' removal question), `label`, `group`, `serverName`, `size`, `status` (a paused or failed one carries its words as `message`), `autoDelete`, `watched: number | null` (1 once `watchedAt` is set, else the resume share, as recents show it), `deletesAt: number | null` (while the clock runs) and `needsUnlock` (paused by a relock). It carries no media id, origin, path or pending.

## Security

- The page never sends a URL, a path or a cookie: a link names a server by origin, which trust turns into a stored server id, and everything after that is an opaque id.
- The five new allowlisted calls are reads, matched by path pattern as the eight existing ones are; nothing else gets through `callFromPage` or main's own `call`, and `callFromPage` refuses `getMediaOrigins` and `getMediaTicket` (`isPageCall`).
- A file fetch goes only to an origin the trusted server itself advertised through `getMediaOrigins`, and only to a plain http or https one, or to the stored origin; never to one the page or the link named. On a media origin it goes through `net.fetch` with `credentials: 'omit'` and carries a ticket and no cookie, so a stray origin in a server's list learns nothing but one file's six-hour ticket; on the stored origin it runs in the server's own session with its cookies, as a stream does. Both use `redirect: 'error'`, so neither a cookie nor a ticket follows a redirect. A `.part` is written only under the downloads folder at a path main computes from ids and a container string that is checked against `isMediaItem`'s `container` and a `[a-z0-9]{1,8}` pattern (my call).
- The `raven-file://` protocol serves the renderer nothing new: downloads play through mpv from a granted path, as dropped files do.
- Deleting a server deletes its downloads' folder by id; nothing else under `userData` is touched.

## Web app

`downloadLinkFor` joins `playLinkFor` in core. A `DownloadButton` in `apps/raven/web/src/components/` renders when `usePlayerPrefs().opensInRavenPlayer` is on and calls `ravenPlayer.open(downloadLinkFor(...))`, with the Icon set's `download` icon. On the redesigned pages it goes in with the page's own actions, the `children` of `ItemHeader`, beside Play: `MoviePage` and `EpisodePage` through `PlayableItemView`, which both render (`primary`, the file Play plays, as `media`), `SeasonPage` and `ShowPage` (`item`); on `SagaPage` it sits beside Play all (`saga` with the library id and `tmdbId`). Its label cannot wrap, so it marks itself `data-wide`, and `ItemHeader` breaks a row holding it into cells under 40rem rather than 27rem, the button on a row of its own. A row of five or more actions holding it (a show's or season's, with Shuffle) breaks under 64rem too, there into even cells at least 15rem wide and at most three to a row (four for a row of seven, where they fit), which hold the button; a row without it lays out as before. The Settings copy for the switch gains "and Download to raven player on a title's page". Tests spy on `ravenPlayer.open` as the watch page's do.

## Testing

- `shared`: `readDownloadLink` accepts the three forms and rejects everything `readPlayLink` rejects plus two targets at once; `downloadLinkFor` round-trips.
- `main/downloads`: the state transitions; `expand` against a fake `calls` (a show with two seasons, a saga, a locked library, the cap); `mediaAccess` against a fake fetch (the probe and the pick, no origin listed, every probe dead, an origin that is not http or https, a ticket read and its `renewAt`); `fetchFile` against a fake streaming fetch (a whole file, a resumed `206`, a `200` on resume, a short file, a stall, `ENOSPC`, a `401` once then a success, a `401` twice); the queue (two at a time, pause and resume, retry, a relock pausing a server's files, an outage pausing a server and its retry, a ticket renewed mid-file, a sleep and a wake); `space` with a fake `statfs`; `autoDelete` with the fake `Timers` (fires on time, at once when overdue, held while playing or mid-title, looks again after the sync wait, cleared on delete and on the switch, armed again after a sleep); `sync` (sends play, then the furthest, then the last position; each server's items one at a time in `pending.at` order; holds a server after an unreachable answer; keeps what changed during a call; sends and drops `owed`).
- `renderer`: the dialog (fits, does not fit, the checkbox default, Download and Cancel send the right requests), the Downloads page (rows by status, actions, the meter and the space line, the empty state), Home's badge, the Settings section.
- `e2e` against `fixtureServer`, which already serves files with ranges and can throttle at a byte, and gains `/api/media-origins` (listing a second listener of its own as `lan`), `/api/media-origins/ping` and `/api/media/:id/ticket` with a ticket per media id (`fixture-ticket-<id>`, its `expiresAt` in epoch milliseconds as the server issues it) that it checks as `?t=`: download a title and see it fetched from the second listener with the ticket and no cookie, ready with the right size; a fixture started with no origins sees the cookie path; throttle, pause, resume and see the `Range` request; download a season and see Home's badge count down; stop the fixture and play the download; relaunch with `RAVEN_DESKTOP_SYNC_RETRY_MS` shortening the retry, start the fixture again and see the play, then the progress report, arrive; delete and see the folder gone. The ten-minute clock is unit-tested only; e2e sets `watchedAt` in `downloads.json` before launch to see a deletion at launch, and its notice once the page is ready.
- `test:native` gains one case, a local file with one sidecar (Playing a download): a download plays as a local file does.

## Order of work (one PR each)

The stack started from `main` before the direct media client stack landed (plan Ruling 1): core had the media plane's contract and ticket reads but not `pickOrigin`, so `mediaAccess.ts` picked with its own rule until the seventh PR moved it to `pickOrigin`, and it builds its URLs itself. The first PR targeted `main`; once it merged, the second did too, and each one after targets the one before.

1. **Links** (#202). `downloadLinkFor`, `readDownloadLink`, `DownloadRequest`, and `LinkOpener` reading a download link. The desktop refuses the link with a clear message until the next step.
2. **State and expansion** (#206). `downloadState`, `downloadStore`, the five allowlisted reads, `expand`, `space`; the `downloadAsk` event, the dialog, and `confirmDownload` queuing entries that only sit there.
3. **Fetching** (#208). `mediaAccess`, `fetchFile`, `downloadQueue`, progress events, the Downloads page with its rows, Home's button and badge, Settings' section, Delete and Delete all, server removal.
4. **Playing and syncing** (#211). `openDownload`, grants that know their download, the file target's sidecars, resume and watched detection, `sync`, Home's recents for downloads.
5. **Auto-delete** (#214). `autoDelete`, the per-row switch and the default, the deferred deletion, the notices.
6. **Web button, e2e and docs** (#226). The web's `DownloadButton` on the five redesigned pages and its Settings copy, last so the desktop can answer the link it offers; the fixture-server suite; `apps/raven/README.md`; `apps/raven/CLAUDE.md` (its Desktop section counts the allowlist's calls, which become thirteen, and the direct media spec's line that the desktop "passes nothing new" gives way to the downloads); the desktop spec's follow-ups; and this document's outcomes.
7. **Follow-ups** (#238). `mediaAccess` picks with core's `pickOrigin`, its probes timed over the whole ping body as the web player times them; `mergePending` keeps a merged owed record's furthest at or above its position; the downloads code compares against main's `as const` objects, not string literals; and a title's action row holding Download stops at three columns between 40 and 64rem, four for a row of seven.

Every log line the downloads write goes through the app's log and its redaction, as the Desktop section of `apps/raven/CLAUDE.md` requires: a line names a download by its title through `loggable`, never by its path.

## Left to the builder

- The exact layout of the Downloads page and the dialog within the rules in the root `CLAUDE.md`: grids with `gap`, raven's tokens from `@raven/ui`, `--focus-ring`, a layout that works at 320px, motion under `prefers-reduced-motion: no-preference`.
- The wording of refusals and notices, kept in a `DOWNLOAD_MESSAGES` constant beside the others.
- How the badge on Home's Downloads button reads to assistive tech.
- Whether the `.part` write goes through a `WriteStream` or appends per chunk, as long as a crash leaves the `.part` at a length the resume can trust. It appends per chunk and syncs to disk before it closes; every resume reads the `.part`'s size, so the entry's `bytes` may be saved mid-stream (plan Ruling 8, as amended).
- Whether sidecar fetches share the two slots or run beside their file. They run in their file's slot, after the video, all at once.

## Risks

| Risk | Answer |
| --- | --- |
| A show of hundreds of episodes takes hours and the viewer quits | The queue persists; it resumes at launch from each `.part`, and the badge shows what is left |
| The disk fills while downloading | The reserve, the per-file check and the `ENOSPC` failure; nothing else on the computer is touched |
| The server's file at an id changes to one of the same length | Accepted, as a stream would read it; a rescan that renumbers files makes the id `404`, which Retry reports |
| Ten minutes feels too short or too long | One constant, `AUTO_DELETE_DELAY_MS`, and the setting is per download |
| The sync sends a position the viewer did not mean (a rewatch from the start) | The server already handles a position going back as a new play within the sitting rule; the download sends what the player saved, nothing invented |
| The server advertises a media origin this computer cannot reach (a LAN name, away from home) | The probe skips it; when none answers, the fetch falls back to the stored origin and the cookie, which is how the title streams today. A wake from sleep forgets the pick, so a Mac carried home picks the LAN again |
| The server cannot be reached mid-queue (a NAS restarting, a dropped connection) | One file fails as unreachable, the server's others pause, and they are tried again at launch, after a wake and every five minutes |
| A ticket runs out mid-file, or the library relocks | A fresh ticket 5 h 50 m after the last was read, by raven player's clock; one re-read on `401` or `423`, then a `401` fails the file, a `423` pauses the server's files as relocked, and Resume unlocks |

## Outcomes

The stack shipped from `docs/superpowers/plans/2026-10-17-raven-desktop-downloads.md`. Three of its Rulings change what this spec proposed:

1. **Built before the direct media client (plan Ruling 1).** The user asked for the stack before `direct-media-client` landed, so it was built on `main` as it stood. The media plane's server side and core's contract were there (`isMediaOrigins`, `isMediaTicket`, `MEDIA_PROBE_BYTES`, `MEDIA_TICKET_REFRESH_SECONDS`, `getMediaOrigins`, `getMediaTicket`); `pickOrigin` was not, so `mediaAccess.ts` picked with its own rule until the seventh PR moved it to `pickOrigin`; it builds its own URLs.
2. **The origin pick (plan Ruling 6).** Every listed origin that is plain http or https is probed at once through `net.fetch` with no cookie, `redirect: 'error'`, `cache: 'no-store'` and a 2 s timeout. The pick was first the nearest kind of those that answered 200, then the quickest first byte; the seventh PR swapped it for core's `pickOrigin`, the web player's rule, with each probe timed over its whole body, so a LAN origin far slower than the tailnet one no longer wins on its kind. None scoring, or none listed, is the cookie path. The pick is held in memory per server until a fetch fails to connect, stalls or meets a 5xx, the server is removed or the Mac wakes, and is never persisted.
3. **Tickets (plan Ruling 7, as amended).** A ticket is read per file, held in memory, and renewed by aborting the fetch and resuming at the same byte. The plan timed the renewal from `expiresAt`, but the server issues `expiresAt` in epoch milliseconds where core's contract said seconds, so the desktop renews `TICKET_RENEW_MS` (5 h 50 m) after it read the ticket, by its own clock, as the web client does, and never reads `expiresAt` for timing; core's comment now says milliseconds. A `401` or `423` reads a new ticket once per ticket; a second `401` fails the file, a second `423` pauses the server's files as relocked.

What else differs from the proposal:

- An offline position synced after a later one streamed on another device moves the server's resume spot back, until another report moves it. Nothing on the desktop can tell: the server takes no time with a play or a report, and `getMedia` gives none for its resume spot. Dated reports beside dated plays are a server follow-up.
- "Downloaded <title>" also shows while the Downloads page is open. Delete all can race a download confirmed while it runs (rare).
- A held deletion shows nothing on its row. A rewatch reads 100%, since `watchedAt` is first reached. Empty `downloads/<serverId>/` folders stay after a season goes.
- Home's bar and the download's row read "Not started" for a fresh download that will open at the server's spot.
- An episode's page sends `media=` with the file Play starts there, while a season or show takes each episode's `primary`, so where the page shows another file than the season's `primary` (a page kept to another library, say), one episode can be downloaded in two versions. An `item=` link naming an episode, which raven web never builds, takes `versions[0]`.
- The ask creates `userData/downloads` when it reads free space, before Download.
