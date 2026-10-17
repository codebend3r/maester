# raven desktop downloads: keep server titles on this computer

Status: proposed, awaiting approval. This builds on the desktop spec, `2026-10-12-raven-desktop-design.md`, whose P6 slice (server titles) shipped: servers in Settings, the `raven://play` link, a session and an allowlist per server, and mpv reading `/api/media/:id/file` with the server's cookie. It also builds on the direct media spec, `2026-10-16-raven-direct-media-design.md`: a download fetches its bytes from the server's media origins with a media ticket, so this stack starts on `main` only once that spec's client stack (`direct-media-client` and the PRs after it) has landed; its server side and the redesign (PR 197, Verdigris) landed on 2026-10-17, so the web app's part targets the redesigned pages.

## Context

raven player plays a title from a raven server by streaming it. Without the server, on a plane or in a house with no connection to the NAS, there is nothing to play. This lets a viewer keep a copy of a server's titles on the computer the player runs on: a movie, a saga, a show, a season or one episode, with its sidecar subtitles. Kept titles play through the native engine from the local copy, with the same controls and resume as any other title, and what was watched reaches the server once it is reachable again.

The desktop app is the only client this is for. The web app's one part is the way in: the pages that already offer "Open in raven player" offer "Download to raven player" beside it. The server changes nothing.

Decided with the user:

- Desktop only. The web app gains the download action and nothing else; the server is untouched.
- The file saved is the server's original, the same bytes mpv streams today, plus the sidecar subtitles the server serves for it. No smaller copy: the desktop has no transcoder yet.
- What can be downloaded: a movie, a whole saga, a whole show, a season, or a single episode.
- Each download has an option to delete itself once watched. Deletion runs ten minutes after the title counts as watched. If the app is quit before then and opened again more than ten minutes after the watched moment, deletion runs at once on launch; opened sooner, the timer resumes for what is left.
- The app shows how much space the disk has free and how much each downloaded video takes.
- The way in is the web app: a `raven://download` link handed to the desktop app, as "Open in raven player" hands a `raven://play` link today. The desktop app keeps no library browser in this slice.
- The bytes come through the media origins and tickets of the direct media spec, as the web player's will, not through the server's cookie; the cookie path stays only as the fallback for a server that advertises no media origin.
- This stack waits for the direct media client stack and the redesign to land, and is built on `main` after them.
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
- Progress that the server never hears of, or hears twice as two plays, or that overwrites a later streamed position with an older offline one.
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

The checkbox starts from the last choice made, off the first time. A locked library asks for the PIN first, through the same `UnlockDialog` server titles use; an admin lock asks for the password first, the same way. When the files will not fit, the dialog says so instead of offering Download: "Needs 41.2 GB; 12.0 GB free." Download closes the dialog and queues every file; a notice says "Downloading 3 movies from Vhagar", and Home's Downloads button shows the work.

**Downloads page.** Reached from a **Downloads** button in Home's header beside Settings, which shows a badge with the number still downloading. The page is a grid:

- A header: Back, the title "Downloads", and a line "34.2 GB of downloads · 412 GB free of 1 TB". A `meter` under it shows the disk, with downloads as the filled part, labelled for assistive tech.
- A list, newest first, one `li` per file. Each row shows the title and where it came from ("S02E04 · Severance · Vhagar", "The Two Towers · The Lord of the Rings · Vhagar"), its size, and its state: a `progress` element with "12.1 of 14.8 GB" while downloading, "Waiting" while queued, "Paused", "Failed: <why>" or, once ready, the size alone. A ready row shows a watched bar like Home's recents, and "Deletes in 7 minutes" while the clock runs.
- Each row's actions: **Play** (ready only), **Pause** or **Resume** (while queued or downloading, or paused), **Retry** (failed), a **Delete once watched** switch, and **Delete**, which asks once ("Delete *The Two Towers*? 14.8 GB will be freed.").
- A **Pause all** / **Resume all** button in the header while anything is in progress.
- An empty state: "Nothing downloaded yet. Open a title in raven on the web and choose Download to raven player."

Rows of one show or saga are not grouped in this slice; the second line of each row says what it belongs to, and the list sorts a group's files together, in play order, under the newest of them.

**Home.** A downloaded title opened from Downloads joins the recents as any opened file does, with "Downloaded from Vhagar" as where it came from. A download that has been deleted leaves the recents.

**Settings.** A **Downloads** section: the default for "Delete once watched", a **Delete all downloads** button with a confirmation, and the line "Downloads are kept in raven player's data folder" with a **Show in Finder** button. Removing a server from Settings deletes its downloads too; the removal confirmation says so when there are any.

**While playing a download.** The player is the native engine over the local file, exactly as for a dropped file: resume, track picks, next in queue. The up-next list is the rest of the download's group in play order (the next episode, the next movie of the saga), ready ones only. Back returns Home. No "Open in browser" or server-side action shows.

**Notices.** "Downloaded *The Two Towers*" when a file finishes while the page is not on Downloads; "Deleted *The Two Towers* after watching" when the clock runs out; "Could not download *The Two Towers*: <why>" on failure.

## The link

In `@raven/core`'s `playLink.ts`, beside `playLinkFor`:

```
raven://download?server=<origin>&media=<id>
raven://download?server=<origin>&item=<id>
raven://download?server=<origin>&saga=<libraryId>:<tmdbId>
```

Exactly one of `media`, `item` or `saga`. `media` is a file (the movie page's or episode page's Play target, `primary` or the best version). `item` is a show or a season, by its item id; an episode or movie item is also accepted and resolves to its best file. `saga` names the library's saga by the TMDB collection id, since a saga has no id of its own (`GET /api/libraries/:id/sagas` lists them by `tmdbId`).

`downloadLinkFor` builds it in core, `readDownloadLink` in `apps/raven/desktop/src/shared/playLink.ts` reads it with the same strictness as `readRavenLink`: a bare http or https origin, ids as `isMediaId` accepts them, no unknown or repeated keys, no hash, a 4096-character cap. The web pages call `downloadLinkFor` with `window.location.origin`, as the watch page does for play links. `open-url` in main already reads every `raven://` link through `LinkOpener.open`; it now reads a download link too, trusts its server the same way (the native "Add the raven server at ...?" prompt), and answers `{ type: 'askDownload', ask }` (below) instead of `playServer`.

## Processes and files

Everything lives in the desktop app's main process, beside the servers, with the page holding ids and views only.

```
apps/raven/desktop/src/
  shared/
    playLink.ts            readDownloadLink, DownloadRequest
    protocol.ts            the new requests, replies and events
  main/
    downloads/
      downloadState.ts     the persisted shape, its guard and the pure transitions
      downloadStore.ts     downloads.json through the JsonStore
      expand.ts            a link's target to the list of files to fetch
      mediaAccess.ts       a server's media origins, their probe, the pick and the tickets
      fetchFile.ts         one file, with ranges, to disk
      downloadQueue.ts     the queue: what runs, pausing, retrying, progress events
      space.ts             free space and the reserve
      autoDelete.ts        the ten-minute clock
      sync.ts              pending plays and positions to the server
      downloadService.ts   the page's requests, wired from the above
  renderer/
    DownloadsPage/         the page and its rows
    Shell/DownloadDialog   the ask
    SettingsPage/Downloads the section
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

The file is named `video.<container>` from `MediaItem.container`, never from the server's `fileName`, so nothing from the server reaches a path. The title lives in the state and in the page. One folder per file also keeps "next in folder" (`grantNext`) from treating two downloads as siblings; the queue for a download comes from its group instead.

## State

`downloads.json`, version 1, read once at launch through `loadJson` with a guard built from core's combinators (a bad file is kept aside as `.corrupt-<time>` and the app starts with none, as the others do), written through the same debounced `JsonStore` as `player-state.json`, flushed on `before-quit`.

```ts
type DownloadEntry = {
  downloadId: string            // opaque, the only handle the page holds
  serverId: string
  mediaId: number
  label: string                 // "The Two Towers", "S02E04 Trojan Horse"; tidied like a recent's
  group: {
    kind: 'movie' | 'episode' | 'season' | 'show' | 'saga'
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
    | { kind: 'paused'; bytes: number }
    | { kind: 'failed'; bytes: number; message: string }
    | { kind: 'ready' }
  autoDelete: boolean
  watchedAt: number | null      // when playback first reached watchedPercent
  pending: { play: boolean; position: number | null; at: number }  // what the server has not heard yet
  createdAt: number
}

type DownloadsState = {
  version: 1
  entries: DownloadEntry[]
  autoDeleteDefault: boolean
}
```

Progress positions for a download are kept where every local file's are: `player-state.json`'s `resume` list, by path. `pending.position` holds only what the server still needs to hear.

`downloadState.ts` holds the transitions as pure functions over the state, with tests: `queue`, `start`, `advance`, `pause`, `resume`, `fail`, `finish`, `remove`, `setAutoDelete`, `noteWatched`, `notePending`, `clearPending`, `removeServer`. A transition on an unknown id returns the state unchanged.

## Expanding a link

`expand.ts` turns a `DownloadRequest` into the files to fetch. Five reads join the allowlist in `allowlist.ts`, each a `GET` main makes on its own and the page may also make: three for the expansion, two for fetching (below).

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

Each file arrives as a `MediaItem`, which carries `size`, `container`, `duration` and `libraryId`. The group's `watchedPercent` is read once per library. A file already downloaded or in the queue is skipped, so downloading a show after one of its episodes adds the rest. The expansion is capped at `DOWNLOAD_MAX_FILES = 500` files in one ask; past it the ask is refused with "That is more than raven player downloads at once." A locked answer (`LOCKED_STATUS` in `@raven/core`, 423) from any read opens `UnlockDialog`, a `404` with the admin lock on asks for the admin password, as `ServerPage` does today; after unlocking, the expansion runs again. `GET /api/libraries/:id` is public, so `watchedPercent` is readable before the unlock.

The expansion's answer is the ask the dialog shows:

```ts
type DownloadAsk = {
  askId: string                  // main holds the expanded files under it until answered, 10 minutes at most
  serverName: string
  title: string                  // the saga's or show's name, or the file's label
  kind: 'movie' | 'episode' | 'season' | 'show' | 'saga'
  files: number
  bytes: number
  free: number
  fits: boolean
  autoDelete: boolean            // the default
}
```

The page answers `{ type: 'confirmDownload', askId, autoDelete }` or `{ type: 'declineDownload', askId }`. Main never queues on the link alone: nothing is written to disk before the viewer says Download.

## Space

`space.ts` reads `fs.promises.statfs` on the downloads folder: free is `bavail * bsize`, total is `blocks * bsize`. The reserve is `SPACE_RESERVE_BYTES = 2 GiB`: an ask fits when `bytes + reserve <= free`, where `bytes` counts only files not yet on disk. The queue checks again before each file starts, since the disk may have filled since the ask; one that no longer fits fails with "Not enough space" and the rest of its group wait, paused, with the same message. An `ENOSPC` mid-file fails the file the same way, keeping its `.part` for a resume. The Downloads page reads free, total and the sum of ready and partial bytes through `{ type: 'readSpace' }`, refreshed each time the page opens and when a file finishes or is deleted.

## Fetching a file

`fetchFile.ts` fetches one URL to one path with a `ServerFetch`-shaped dependency that streams: `ses.fetch` on the server's own session, as `serverCalls` uses, with `redirect: 'error'`. Where the bytes come from follows the direct media spec, through `mediaAccess.ts`:

**The origin.** Before a server's queue starts, and again after a fetch that fails to connect, main reads `getMediaOrigins` (through the stored origin with the session's cookies, as every allowlisted call goes), probes each origin with `GET {origin}/api/media-origins/ping?bytes=262144` (`MEDIA_PROBE_BYTES` in core, a 2 second timeout each) and picks one with core's `pickOrigin`, the pure function the web app's `useMediaOrigin` uses. The pick is held in memory per server for the queue's run, never persisted. A server that lists no origin, or whose origins all fail the probe, falls back to the stored origin: the fetch then goes to `${server.origin}/api/media/...` with the session's `raven_unlock` and `raven_admin` cookies, exactly as mpv streams today.

**The ticket.** On a media origin the fetch carries no cookie (`credentials: 'omit'`): the file's `getMediaTicket` (through the stored origin, with the cookies, so a locked library answers `LOCKED_STATUS` here) gives `{ ticket, expiresAt }`, and the URL is `${origin.url}/api/media/${mediaId}/file?t=${ticket}`, a sidecar's `${origin.url}/api/media/${mediaId}/subtitles/${trackId}?t=${ticket}`, with the track id checked against the server's `external-N` naming as the sources do. Main builds every URL itself, the way core's `fileUrl` builds one from a `MediaAccess`; the page never sees a ticket or an origin. A ticket lasts six hours and a large file may outlast it, so a fetch still running ten minutes before `expiresAt` reads a fresh ticket and continues with a new range request from the bytes on disk; a `401` or `423` from the media origin reads a new ticket once and resumes the same way, and a second one fails the file (a `423` as relocked, below). A ticket lives in memory only: never in `downloads.json`, never in a log line.

- A fresh file writes to `video.<container>.part`. A resumed one sends `Range: bytes=<done>-` and expects `206` with `content-range: bytes <done>-<size-1>/<size>`; a `200`, or a `content-range` that does not match, starts the file over from byte 0. The server's `accept-ranges: bytes` route serves exactly this.
- Bytes are appended as they arrive; every `PROGRESS_STEP_BYTES = 8 MiB`, or every second, whichever is later, the entry's `bytes` advances and the page hears a `downloads` event (below).
- A read that stalls for `DOWNLOAD_STALL_MS = 30 s` fails the file as unreachable. A failure keeps the `.part`; Retry and Resume continue from it.
- When the stream ends, the `.part` must be exactly `size` bytes; any other length fails with "The file changed on the server" and the `.part` is deleted. Then the sidecars are fetched whole (each is small; a failed sidecar is logged and skipped, as a late track list is today), and the `.part` is renamed into place. Only then is the entry `ready`, and a notice goes out.
- Two files download at once (`DOWNLOAD_CONCURRENCY = 2`), in queue order; the rest wait. A server that answers `LOCKED_STATUS` mid-queue, to a ticket read or to the cookie path's fetch (relocked: the PIN cookie lasts twelve hours and dies with the server process), pauses the rest of its files with "Vhagar locked this library again"; Resume runs the unlock flow.

A file is identified to the server only by its id. If the server's title for that id has changed (another file at the same id after a rescan), the size check catches a different length; a same-length swap is accepted, as it would be for a stream.

## Playing a download

The page asks `{ type: 'openDownload', downloadId }`. Main grants the file's path (`grant(path)`, the one way in for every local file), builds the queue from the group's other ready entries in `order` after this one, and answers `{ type: 'play', target: { fileId, queue } }`, so the renderer's `PlayRoute` plays it as it plays any local file. `describeFile` answers a `LocalFile` whose `folder` reads "Downloaded from Vhagar", so the player's header and Home's recents say where it came from.

**Sidecars.** A file `LoadTarget` carries no sidecars today: `sub-add` runs only for a `ServerTarget`. The file target gains an optional `sidecars` list of local paths with their titles and languages, which `resolveSourceWith` fills for a grant that belongs to a download (from the entry's `sidecars` and the `subtitles/` folder) and leaves empty for every other file, and `playerService` runs `sub-add` for a file target's sidecars as it does for a server's. mpv's own auto-load is not relied on: it only finds same-stem files beside the video, and two tracks of one language would collide there. `test:native` gains one case, a local file with one sidecar. (My call; the reviewer raised it.)

Grants for downloads are remembered by main as belonging to a download (`grants.noteDownload({ fileId, downloadId })`), so:

- `savePosition` for such a file saves the resume spot as for any local file, then also records `pending.position` and checks the watched rule: `position / duration >= watchedPercent / 100` sets `watchedAt` when it is null. `duration` is the player's reported length, falling back to the entry's. Reaching `END_MARGIN_S` from the end clears the local resume spot as it does for files; `watchedAt` is what the delete clock reads, so a title that ends is watched by either rule.
- The first `savePosition` after an open sets `pending.play`, so the server records the play once, as `recordPlay` does for a stream.

Nothing in playback waits on the server.

## Reaching the server

`sync.ts` sends what is pending through the allowlisted calls that exist: `recordPlay` (`POST /api/media/:id/plays`) when `pending.play`, then `saveProgress` (`PUT /api/media/:id/progress`) with `pending.position`. The server's `report()` already treats a position past Watched at as a watched play and clears the server's resume spot, so no new server route is needed and the marks come out right.

When it runs: after every `savePosition` for a download (debounced `SYNC_DEBOUNCE_MS = 2 s`, so a playing download reports as a stream would), at launch, when the Downloads page opens, and every `SYNC_RETRY_MS = 5 min` while anything is pending. A call that fails as unreachable leaves `pending` as it is; a `403` or `404` leaves it too and is logged (a relocked library hears it after the next unlock; a title gone from the server never will, and its pending is dropped when the download is deleted). A success clears `pending.play` and clears `pending.position` only if it still equals what was sent, so a position saved during the call is not lost.

An older offline position never overwrites a newer streamed one by accident in practice, because the server keeps the last report it hears and a download's reports are sent in the order they were made, each replacing the one before. The one race, playing the same title streamed on another device while this one syncs, is accepted.

## Auto-delete

`autoDelete.ts` keeps one timer per entry whose `autoDelete` is on and `watchedAt` is set, through the injected `Timers`, firing at `watchedAt + AUTO_DELETE_DELAY_MS` (ten minutes), or at once when that is already past. It is rebuilt at launch from the loaded state, when `watchedAt` is set, when `autoDelete` is switched on (a title already watched then starts its ten minutes from that moment, so switching the option on never deletes at once: my call), and cleared when `autoDelete` is switched off or the entry is deleted.

When a timer fires while the entry's file is the one playing (its grant is the player's current source), the deletion is deferred until the player leaves it, then runs at once. The deletion removes the entry's folder, drops its recent and its resume spot, syncs whatever is pending one last time (best effort), and sends a notice. Deleting never touches the `.part` of another entry and never runs for an entry that is not `ready`.

## Protocol

Added to `protocol.ts`, each guarded with core's combinators as the rest are:

Requests from the page: `confirmDownload`, `declineDownload`, `listDownloads`, `openDownload`, `pauseDownload`, `resumeDownload`, `retryDownload`, `deleteDownload`, `setDownloadAutoDelete`, `pauseAllDownloads`, `resumeAllDownloads`, `deleteAllDownloads`, `readSpace`, `setDownloadDefaults`, `showDownloadsFolder`. Every one names an entry by `downloadId` (an `isOpaqueId`) and nothing else.

Replies: `downloadAsk` (the `DownloadAsk`), `downloads` (the list of `DownloadView`), `space` (`{ free, total, used }`), and the existing `play`, `done` and `refused`.

Events main pushes: `downloadAsk` when a link arrives (the Shell shows the dialog, as it shows `OpenLinkDialog` for `openLink`), `downloads` with the full list on every change (at most four a second), and the existing `notice`. The Downloads page holds the list in a TanStack query keyed `['desktop', 'downloads']` that the event updates, so a page opened mid-download is right at once.

`DownloadView` is the entry without `serverId`, `mediaId` and `pending`, plus `serverName`, `watched: number | null` (the resume share, as recents show it) and `deletesAt: number | null`.

## Security

- The page never sends a URL, a path or a cookie: a link names a server by origin, which trust turns into a stored server id, and everything after that is an opaque id.
- The five new allowlisted calls are reads, matched by path pattern as the eight existing ones are; nothing else gets through `callFromPage` or main's own `call`.
- A file fetch goes only to an origin the trusted server itself advertised through `getMediaOrigins`, or to the stored origin; never to one the page or the link named. On a media origin it carries a ticket and no cookie, so a stray origin in a server's list learns nothing but one file's six-hour ticket; on the stored origin it carries the session's cookies, as a stream does. Either way it runs in the server's own session with `redirect: 'error'`, so neither a cookie nor a ticket follows a redirect. A `.part` is written only under the downloads folder at a path main computes from ids and a container string that is checked against `isMediaItem`'s `container` and a `[a-z0-9]{1,8}` pattern (my call).
- The `raven-file://` protocol serves the renderer nothing new: downloads play through mpv from a granted path, as dropped files do.
- Deleting a server deletes its downloads' folder by id; nothing else under `userData` is touched.

## Web app

`downloadLinkFor` joins `playLinkFor` in core. A `DownloadButton` in `apps/raven/web/src/components/` renders when `usePlayerPrefs().opensInRavenPlayer` is on and calls `ravenPlayer.open(downloadLinkFor(...))`, with the Icon set's `download` icon. On the redesigned pages it goes in with the page's own actions, the `children` of `ItemHeader`, beside Play: `MoviePage` (the movie's best file as `media`), `EpisodePage` (`primary` as `media`), `SeasonPage` and `ShowPage` (`item`); on `SagaPage` it sits beside Play all (`saga` with the library id and `tmdbId`). The Settings copy for the switch gains "and Download to raven player on a title's page". Tests spy on `ravenPlayer.open` as the watch page's do.

## Testing

- `shared`: `readDownloadLink` accepts the three forms and rejects everything `readPlayLink` rejects plus two targets at once; `downloadLinkFor` round-trips.
- `main/downloads`: the state transitions; `expand` against a fake `calls` (a show with two seasons, a saga, a locked library, the cap); `mediaAccess` against a fake fetch (the probe and the pick, no origin listed, every probe dead, a ticket read, a ticket refreshed before expiry); `fetchFile` against a fake streaming fetch (a whole file, a resumed `206`, a `200` on resume, a short file, a stall, `ENOSPC`, a `401` once then a success, a `401` twice); the queue (two at a time, pause and resume, retry, a relock pausing a group); `space` with a fake `statfs`; `autoDelete` with the fake `Timers` (fires on time, at once when overdue, deferred while playing, cleared on delete and on the switch); `sync` (sends play then position, keeps pending on failure, keeps a newer position).
- `renderer`: the dialog (fits, does not fit, the checkbox default, Download and Cancel send the right requests), the Downloads page (rows by status, actions, the meter and the space line, the empty state), Home's badge, the Settings section.
- `e2e` against `fixtureServer`, which already serves files with ranges and can throttle at a byte, and gains `/api/media-origins` (listing a second listener of its own as `lan`), `/api/media-origins/ping` and `/api/media/:id/ticket` with a fixed ticket it checks as `?t=`: download a title and see it fetched from the second listener with the ticket and no cookie, ready with the right size; a fixture started with no origins sees the cookie path; throttle, pause, resume and see the `Range` request; stop the fixture and play the download; restart it and see the progress report arrive; delete and see the folder gone. The ten-minute clock is unit-tested only; e2e sets `watchedAt` in `downloads.json` before launch to see a deletion at launch.
- `test:native` is unchanged: a download plays as a local file does.

## Order of work (one PR each)

The stack starts from `main` once the direct media client stack has landed there, so `pickOrigin`, `MediaAccess` and the ticket reads exist in core; the first PR targets `main` and each one after targets the one before.

1. **Links.** `downloadLinkFor`, `readDownloadLink`, `DownloadRequest`, and `LinkOpener` reading a download link. The desktop refuses the link with a clear message until the next step.
2. **State and expansion.** `downloadState`, `downloadStore`, the five allowlisted reads, `expand`, `space`; the `downloadAsk` event, the dialog, and `confirmDownload` queuing entries that only sit there.
3. **Fetching.** `mediaAccess`, `fetchFile`, `downloadQueue`, progress events, the Downloads page with its rows, Home's button and badge, Settings' section, Delete and Delete all, server removal.
4. **Playing and syncing.** `openDownload`, grants that know their download, the file target's sidecars, resume and watched detection, `sync`, Home's recents for downloads.
5. **Auto-delete.** `autoDelete`, the per-row switch and the default, the deferred deletion, the notices.
6. **Web button, e2e and docs.** The web's `DownloadButton` on the five redesigned pages and its Settings copy, last so the desktop can answer the link it offers; the fixture-server suite; `apps/raven/README.md`; `apps/raven/CLAUDE.md` (its Desktop section counts the allowlist's calls, which become thirteen, and the direct media spec's line that the desktop "passes nothing new" gives way to the downloads); the desktop spec's follow-ups; and this document's outcomes.

Every log line the downloads write goes through the app's log and its redaction, as the Desktop section of `apps/raven/CLAUDE.md` requires: a line names a download by its title through `loggable`, never by its path.

## Left to the builder

- The exact layout of the Downloads page and the dialog within the rules in the root `CLAUDE.md`: grids with `gap`, raven's tokens from `@raven/ui`, `--focus-ring`, a layout that works at 320px, motion under `prefers-reduced-motion: no-preference`.
- The wording of refusals and notices, kept in a `DOWNLOAD_MESSAGES` constant beside the others.
- How the badge on Home's Downloads button reads to assistive tech.
- Whether the `.part` write goes through a `WriteStream` or appends per chunk, as long as a crash leaves the `.part` at a length the resume can trust (a final `fsync` before the entry's `bytes` is persisted).
- Whether sidecar fetches share the two slots or run beside their file.

## Risks

| Risk | Answer |
| --- | --- |
| A show of hundreds of episodes takes hours and the viewer quits | The queue persists; it resumes at launch from each `.part`, and the badge shows what is left |
| The disk fills while downloading | The reserve, the per-file check and the `ENOSPC` failure; nothing else on the computer is touched |
| The server's file at an id changes to one of the same length | Accepted, as a stream would read it; a rescan that renumbers files makes the id `404`, which Retry reports |
| Ten minutes feels too short or too long | One constant, `AUTO_DELETE_DELAY_MS`, and the setting is per download |
| The sync sends a position the viewer did not mean (a rewatch from the start) | The server already handles a position going back as a new play within the sitting rule; the download sends what the player saved, nothing invented |
| The server advertises a media origin this computer cannot reach (a LAN name, away from home) | The probe skips it; when none answers, the fetch falls back to the stored origin and the cookie, which is how the title streams today |
| A ticket runs out mid-file, or the library relocks | A fresh ticket ten minutes before expiry; one refetch on `401` or `423`, then the group pauses as relocked and Resume unlocks |
