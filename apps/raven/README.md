<picture>
  <source media="(prefers-color-scheme: dark)" srcset="web/public/brand/raven-mark-on-dark.svg">
  <img src="web/public/brand/raven-mark-on-light.svg" alt="" width="88">
</picture>

# raven

A light, self-hosted video library and player. Point it at folders of videos; it indexes them, makes a thumbnail for each, and plays them in the browser straight from disk, converting on the fly only what the browser cannot play.

raven is the `apps/raven/` folder of an Nx workspace; the [root README](../../README.md) covers the workspace.

## Run it with Docker

1. Edit the volumes in `apps/raven/docker-compose.yml` so each media folder is mounted read-only under `/media`.
2. From `apps/raven/`, `docker compose up -d --build`. The image builds from the repo root, where the workspace's `bun.lock` lives.
3. Open `http://<host>:8484`, choose **Add library**, and pick folders under `/media` with the folder browser.
4. For posters and details in Movies libraries, copy `.env.example` to `.env` beside the compose file and set `TMDB_API_TOKEN` (see [Metadata](#metadata)). Without it raven works as before.

Deleting a video from the app removes the file, so leave `:ro` off any mount where that should work. On a read-only mount the app keeps the video and says why. Deleting needs the [admin lock](#admin-lock) off, which needs `ADMIN_PASSWORD` in `.env`.

The index and thumbnails live in `./data` (mounted at `/config`). The image runs as the unprivileged `node` user (1000:1000); on a Synology, set `user:` in the compose file to the owner of `./data`.

### Running on Vhagar

raven runs on Vhagar, the NAS with an Intel GPU, from `docker-compose.vhagar.yml`, which lives there as `/volume1/docker/raven/docker-compose.yml`. Every NAS's share is mounted read-write under `/media/<nas>`: Vhagar's own share directly, the other four through the cifs mounts Vhagar already has of them in `/volume1/Vhagar/`. Each share also holds folders for the others, so pick a library's folders inside one share rather than a whole share.

Merges to `main` deploy themselves:

1. The main smoke test builds the image, checks `/api/health`, and, when the merge changed anything that goes into the image, pushes it to `ghcr.io/codebend3r/raven` as `latest` and as the commit.
2. On Vhagar, DSM's Task Scheduler runs `vhagar-update.sh` (there as `update.sh`) as root every five minutes. It pulls `latest`, and when that is not the image raven runs, stops raven, copies `data/raven.db*` to `backups/<time>/` (the last five are kept), and starts the new image. It writes what it did to `update.log`.

Nothing on Vhagar takes instructions from GitHub, and GitHub holds no NAS credentials: Vhagar only pulls a public image.

To set the task up, in DSM: **Control Panel → Task Scheduler → Create → Scheduled Task → User-defined script**. Name it `raven update` and run it as `root`; on **Schedule**, run daily, every 5 minutes, from 00:00 to 23:55; on **Task Settings**, the script is `bash /volume1/docker/raven/update.sh`. DSM asks for your password, as it does for every task that runs as root.

To go back to an earlier build, set `image:` to `ghcr.io/codebend3r/raven:<commit>` and run `update.sh`; put `latest` back to follow `main` again. A backup's files go back into `data/` with raven stopped.

Without GitHub, the image can still be built on a Mac and loaded on Vhagar. Vhagar's docker has no buildx, which the Dockerfile needs. From the repo root:

```bash
docker buildx build --builder desktop-linux --platform linux/amd64 -f apps/raven/Dockerfile -t ghcr.io/codebend3r/raven:latest --load .
docker save ghcr.io/codebend3r/raven:latest | gzip -1 | ssh vhagar 'cat > /volume1/docker/raven/raven-image.tar.gz'
```

Then, on Vhagar, `sudo docker load -i /volume1/docker/raven/raven-image.tar.gz` and `sudo docker compose up -d` in `/volume1/docker/raven/`. Pause the task first, or its next run puts `latest` from GHCR back.

### Coming from weirwood

raven was called weirwood. Its database is now `raven.db`, and the server renames a `weirwood.db` it finds in the data folder, with its `-wal` and `-shm` files, the first time it starts. To move a running weirwood container over:

1. `docker compose down` in `apps/weirwood/`.
2. Move `apps/weirwood/data` to `apps/raven/data`, and copy your media volume lines from `apps/weirwood/docker-compose.yml` into `apps/raven/docker-compose.yml`.
3. `docker compose up -d --build` in `apps/raven/`.

The player forgets its volume and mute setting once, since the browser now keeps it under raven's name.

## How playback works

Three ways, cheapest first:

| Mode      | When                                                                                     | What the server does                                                       |
| --------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Direct    | The browser plays the file as it is, and the default audio track is wanted               | Serves the original file over HTTP range requests                          |
| Remux     | The container or audio is the problem, or another audio track is picked                  | ffmpeg copies the video untouched and converts the chosen audio to AAC     |
| Transcode | The browser cannot decode the video either                                                | ffmpeg re-encodes the video to H.264 (at most 1080p, HDR tone mapped) too   |

Direct play starts as soon as the first bytes arrive (about half a second for a 1080p file on the NAS over SMB), and seeking is just another range request. A remux costs little more than reading the file. A transcode is CPU heavy: fine for 1080p on a modern x86 core, not for 4K.

Before loading a file, the player asks the browser whether it can decode that exact container, video codec, and audio codec (`canPlayType`), using codec strings built from the ffprobe data in the index, and whether it could play a converted stream (`MediaSource.isTypeSupported`). Cards and pages carry the same check, and say only when nothing will work: "Won't play in this browser". A file the server converts, as most 4K files are, plays without a word. If a mode fails once playing (the browser said "maybe" and could not decode after all), the player steps down to the next one from the same spot; only when every mode has failed does it say why and offer the file link for VLC or IINA.

Converted streams are fragmented MP4 fed to the browser through Media Source Extensions (`ManagedMediaSource` on iOS). ffmpeg keeps the file's own timestamps (`-copyts -start_at_zero`, `frag_discont`, no edit list), shifted by one second so nothing goes negative, so a stream started anywhere lands at the right place on one timeline. Seeking inside what is buffered is instant; seeking outside it starts a new stream there, and the server kills the old ffmpeg as soon as its request closes. The player reads at most a minute ahead, which holds ffmpeg back through the pipe.

What that means in practice. Chrome and Firefox 156 were measured on a Mac with `canPlayType`; Safari is Apple's documented support. The player asks the browser itself, so treat this as a guide rather than a rule:

|                        | Chrome                  | Firefox      | Safari                  |
| ---------------------- | ----------------------- | ------------ | ----------------------- |
| MP4 / MOV              | yes                     | yes          | yes                     |
| MKV                    | yes                     | yes          | no                      |
| H.264                  | yes, 10-bit too         | 8-bit only   | yes                     |
| HEVC, including 10-bit | with a hardware decoder | yes on macOS | yes                     |
| VP9, AV1               | yes                     | yes          | depends on the hardware |
| AAC, MP3, Opus, FLAC   | yes                     | yes          | yes                     |
| AC3 / EAC3 (Dolby)     | no                      | no           | yes                     |
| DTS, TrueHD            | no                      | no           | no                      |

Audio is the usual blocker: most remuxes and many WEB-DLs carry EAC3, DTS or TrueHD.

Playback resumes where you stopped; the last 5% counts as finished.

## Audio tracks and subtitles

The settings button (or `c` for subtitles) lists every audio and subtitle track in the file, read with ffprobe when the player opens it. Picking an audio track other than the file's default plays through a remux. The player remembers the last audio language picked, whether subtitles were on, in which language, and how big.

Subtitles come from the file itself (SRT, ASS, WebVTT, MP4 text) or from files beside it named after the video: `Movie (2020).en.srt`, `Movie (2020).en.forced.srt`, `Movie (2020).English.sdh.ass`. They are drawn by the player rather than the browser, so they look the same everywhere and follow `+` and `-`. Embedded tracks are extracted five minutes at a time, so the first cues arrive after reading minutes of the file rather than all of it, and cached under `<data>/subtitles/`. Picture subtitles (PGS, VobSub) are listed but cannot be shown.

## Keyboard

YouTube's shortcuts, and `?` shows them in the player.

| Key                    | Action                                                 |
| ---------------------- | ------------------------------------------------------ |
| `k`, space             | Play or pause                                          |
| `j` / `l`              | Back / forward 10 seconds                              |
| left / right           | Back / forward 5 seconds                               |
| up / down              | Volume                                                 |
| `m`                    | Mute                                                   |
| `f`                    | Full screen (double click too)                         |
| `c`                    | Subtitles on or off                                    |
| `+` / `-`              | Bigger / smaller subtitles                             |
| `0` to `9`             | Jump to 0% to 90%                                      |
| Home / End             | Start / end                                            |
| `,` / `.`              | Pause, then one frame back / forward                   |
| `<` / `>`              | Slower / faster                                        |
| `Esc`                  | Close a menu, leave full screen, or back to the library |

## Library settings and views

Each library keeps its own settings on the server, so every browser opens it the same way.

- **Type**: Movies, TV shows, Anime movies, Anime shows, Family movies, Family TV shows, Documentaries, Sporting events, YouTube videos or Other. New libraries, and those made before types, are Other. It shows beside the video count, gives the library its icon until it picks another (see **Icon**), and can be changed in **Edit** at any time. A Movies, Anime movies, Family movies, Documentaries or Sporting events library reads its files' names and matches them to TMDB movies, as Radarr files documentaries and as TMDB lists events like UFC cards, and a TV shows, Anime shows or Family TV shows library to TMDB shows (see [Metadata](#metadata)). YouTube videos are not on TMDB, so they keep plain file names like Other. Changing the type matches the files again, or goes back to plain file names; Fix match choices stay. Between two types matched to movies, or two matched to shows, each file is picked again where it stands, so the cards stay up meanwhile and a file that keeps its movie or show keeps its split and edited metadata. Only a change between two types that are never matched (YouTube videos and Other) leaves the files as they are.
- **Icon**: the one the library wears in the side menu, beside its name on its page and on the Libraries page, picked in **Edit** from 24 that span films and shows, sport (UFC, basketball, soccer, American football) and audio (music, lossless music, podcasts, audiobooks). Until one is picked, the library wears its type's, and changes with it; one picked, the type's own included, stays through a change of type.
- **Save where each video stopped**, on by default: leave a video and come back to pick up where it stopped. Turned off, nothing new is saved and nothing resumes, but saved spots are kept for when it is turned back on.
- **Pin to the side menu**, on by default: the library gets its own link under Home and Favourites, above Libraries and Settings, which keep to the foot of the menu (the end of the row on a narrow screen). Pin or unpin from the Libraries page, or in **Edit**. Libraries whose videos are mostly 4K come first, there, on the Libraries page and on Home, then the rest by name.
- **Watched at**, 90% by default: how far into a video playback must get for it to count as watched in the library's history, as a whole percentage from 1 to 100.
- **Refresh automatically**, on by default: raven watches the library's folders and takes in videos as they are added, removed, renamed or replaced, without a rescan. Changes gather until the folders have been still for two seconds (a copy in progress keeps them busy), then only the places that changed are looked at again, without taking over the scan status, and every open page updates on its own. A renamed or moved file stays the same video: its progress, favourite, history, match and thumbnail go with it, and its changed date moves on. On Linux each folder takes one inotify watch; a library that cannot be watched (a share that went away, or a system out of watches, see `fs.inotify.max_user_watches`) is scanned every 10 minutes instead, and watched again the next time a library is saved. A network share mounted from another machine does not report changes made elsewhere, so it still needs a rescan or `RESCAN_INTERVAL_MINUTES`.
- **Lock with the PIN**, off by default: a private library. Its videos, their files, thumbnails and paths, its history, and its movies and shows stay behind `LIBRARY_PIN` until the PIN is entered; the server answers `423 Locked` until then, so no page or player can reach them. Entering it opens every locked library in that browser for 12 hours, until **Lock** on the library's page, or until the server restarts. Any type of library can be locked, and the lock stays through a change of type. Locked libraries keep their name and their icon in the side menu, with a small lock on the icon, and drop out of Favourites and cast pages while locked. On the Libraries page a locked library shows only its name, type and counts: its folders, the picture of its newest video and what its last scan said about its folders stay on the server, and **Edit** asks for the PIN. Once the PIN is entered it shows like any other library, marked Unlocked. Five wrong PINs in a row make it wait a minute. Without `LIBRARY_PIN` no library can be locked, and one already locked stays shut. All of this is with the [admin lock](#admin-lock) off; while it is on, locked libraries are not there at all, and none can be locked.
- **Sort**: title, recently or oldest added, recently changed (found, renamed, moved or replaced), largest or smallest file, highest or lowest bitrate, highest or lowest resolution (by pixel count), newest or oldest release (libraries matched to TMDB), or random. Videos not yet probed, and files with no year, go last. Titles sort without a leading "The", "A" or "An". Random holds its order while the page is open, and each visit starts a fresh deal.
- **View**: a grid of cards, a list, tiles (rows with a small thumbnail), or grouped: by matched or not (a library matched to movies starts here, Matched above Not matched, so what needs a Fix match is in one place), resolution, video codec or month added. Each bucket is a folded row with its count; click it to open the cards. The page of a library matched to shows splits the same way, its shows under a Matched row and the leftover files under Not matched, both folded to start.

Sort, view and grouping are picked on the library page and saved as they change; the others are in **Edit**. Changing a setting or the name never rescans; only a change of folders does.

In every library and view, a strip runs down the right edge of the screen and stays there as the page scrolls, stepping through whatever the listing is sorted by, in its order: the alphabet for titles (a title files under its letter without a leading "The", "A" or "An", and # holds the ones that start with no letter), round steps of bitrate under Mb/s or of size under GB, resolutions, years (decades over a wide span), whole scores in the library's source, and months (years over a wide span) for when videos came or changed. Values not known yet sit under ? at the end. A step jumps to the first card under it in the order shown, opening a folded bucket on the way; a step no card falls under is there but cannot be pressed. A TV library steps its bitrate every 5 Mb/s, each show by its files' mean bitrate, and spells out titles for size and resolution, which its shows sort by title for. A random order has no strip, and neither has a TV library sorted by when videos changed.

Beside the sort, **Play** starts the first video as the page shows it (the top of the first group in the grouped view) and **Shuffle** starts a random one, whatever the sort. Both keep to the search.

## Library tabs

A library's page opens on **All**, its listing with the search, sort and view above. Tabs beside it each have an address of their own under the library's (`/libraries/4/sagas`), so they can be linked to and the back button steps between them, and each reads only what it shows:

- **In progress**: the videos left partway through, the most recently watched first. Empty in a library that does not save where videos stop.
- **Favourites**: the library's own favourites, most recently marked first.
- **Sagas**, in a library matched to movies: the movies gathered by the TMDB collection they belong to (The Lord of the Rings Collection, say), by name, each a deck of its posters, the first movie on top, with how many there are and the years they span. Pointed at or focused, a deck fans out like a hand of cards; it opens the saga's own page (`/libraries/4/sagas/119`), under the backdrop of its first movie, with its movies oldest first to pick one to watch. A collection shows once two of its movies are in the library. Movies matched before sagas were kept learn theirs in the sweep on start, one light call each, with no scores fetched again.
- **Not matched**, in a matched library: the files no movie or show was found for, or still waiting, each with **Fix match** in its menu.
- **Duplicates**, in a library matched to movies: every movie with more than one file, each file with the cut its name reads as (what the name says past the title, year and release, `Alexander 2004 Revisited the Final Cut (2004)` being `Revisited the Final Cut`), else Standard. **Split apart** gives every file a card of its own, titled with its cut or its release (`300 (WEBDL-2160p)`); **Smart split apart** gives each cut its own card and keeps copies of one cut together, so `Alexander (Revisited the Final Cut)` stands beside `Alexander`, which keeps the Remux and the WEBDL. A split movie stays in the list as its separate cards, any that still holds several files splittable again, with **Put back together** to combine them. A split is kept on the files, so rescans and renames keep it; a file found later joins the movie's own card. A split card opens the movie's page on its own file (`/movies/7?file=11`), so Play starts that cut.
- **Recently finished**: the last 48 videos watched by the library's **Watched at** setting, each with the day it last played, and a link to the full [History](#history).

A tab the library's type has no use for, as after a change of type, opens All instead. A locked library shows no tabs until the PIN is entered.

## History

Each library's **History**, linked from its page and its row on the Libraries page, lists the videos played in it, last played first and split into days. **Watched** shows the ones that count as watched by the library's **Watched at** setting; **All played** adds the ones that stopped short, with how far they got.

- A play is recorded when a video starts, and its furthest point as the player saves its position (every 10 seconds, on pause, and on leaving). Starting the same video again within half an hour of its last report is the same play.
- A video counts as watched once any play gets past the library's percentage. One whose length is not known yet never does.
- History is kept whatever **Save where each video stopped** says; that setting is only about resuming. A video's plays go when the video leaves the library.

## Favourites and deleting

Every card has a menu, from the button in its corner or a right click; on a screen with a pointer, the button shows when the card is pointed at or focused. With the [admin lock](#admin-lock) off, the menu ends with where the file lives, and choosing it copies the path. In a matched library it also has **Fix match** and **Refresh details** (see [Metadata](#metadata)), and on a matched movie or episode **Edit images**, which opens the movie's (or the episode's show's) pictures in a dialog over the page, the same as **Edit images** on its page. **Favourite** marks the video and lists it under **Favourites** in the side menu, most recently marked first, across every library. **Delete**, with the admin lock off, asks first, then removes the file from disk and the video from the index, along with its thumbnail, progress and favourite. There is no undo.

## Admin lock

The admin lock keeps what only an admin should do out of every other browser's reach. It is on in every browser until the admin password is entered there, and while it is on:

- Locked libraries are not there at all: not in the side menu, on the Libraries page, on Home, in Favourites or on a cast page, and an address of one answers as if there were no such library, so nothing asks for the PIN. No library can be locked either, as it would drop out of sight.
- No video can be deleted, and no file's path is shown: the card menu leaves out **Delete** and where the file lives, and the server answers `403` to both.

The toggle is at the foot of **Settings**. Turning it off asks for `ADMIN_PASSWORD` and holds in that browser only, for 12 hours, until it is turned on again, or until the server restarts. Turning it on waits 15 seconds before it holds, with the seconds counting down beside it; unticked again in that time, it goes off with no password, so a slip of the finger costs nothing. Five wrong passwords in a row make it wait a minute.

`ADMIN_PASSWORD` must be 10 characters or more, with lower and upper case letters, a digit and a symbol. Without it, or with a weaker one (the server logs a warning on start), the lock stays on everywhere.

## Metadata

A Movies, Anime movies, Family movies, Documentaries or Sporting events library knows what each of its files is: posters, titles and years on its cards, and a page for every movie with its backdrop, director, content rating, runtime, genres, its scores, summary, the file's video, audio and subtitles, its other versions, a cast and crew row with photos, and reviews. A TV shows, Anime shows or Family TV shows library lists its shows the same way, with a page for every show, season and episode. Every person in a cast row has a page listing what raven holds of theirs. YouTube videos and Other libraries stay as they were.

- **Turning it on.** Put TMDB's API Read Access Token, or its 32-character API key, in `apps/raven/.env` as `TMDB_API_TOKEN` (copy `.env.example`; on Vhagar the file sits beside the compose file, and `update.sh` makes an empty one if there is none). Without a token, or without the internet, raven works as before, with movie names tidied into titles and years.
- **Names.** Radarr's `Movie (Year)/Movie (Year) Quality.mkv`, scene names like `The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv`, Plex's `{edition-...}`, an edition named bare at the end of the title (`Avatar Theatrical Cut`, `Spy (Extended)`, `Dances with Wolves (Directors Cut)`), id tags (`{tmdb-603}`, `{imdb-tt0133093}`, `[tmdbid-603]`) and an article sorted to the end (`Whale, The (2022)`) are all read. An edition is one more version of the movie: one card, each cut playable. A movie's own folder is read first when it has a year. Episodes read Sonarr's `Show (Year)/Season 01/Show - S01E02 - Title Quality.mkv`, scene names, `S01E01-E02` and `S01E01E02` for a file holding two episodes, `1x02`, three-digit episodes (`S01E012`) and a `Season N` or `Specials` folder when the name has no code; the show comes from the first folder, then the file name, then the letter or group folder its titles sit in, or the library folder, without Sonarr's country suffix (`Euphoria (US)`). Plex's extras folders (`Featurettes`, `Trailers`, ...) and suffixes (`-trailer`, ...) are never matched.
- **Letter and group folders.** Letter folders and group folders are read as holding the titles: in `A/Andor/Season 1/` the show is Andor, and in `Requests/Cupertino/Season 1/` it is Cupertino. A letter folder is one letter, `#`, `0-9` or a run such as `A-C`. A show named with one letter keeps its name when its season folders sit right under it (`K/Season 1/`). In a movie library, a folder with no year that holds folders with years (`Requests/25th Hour (2002)/`) is a group folder too. Edit library shows what each path was read as, and "Read letter and group folders" turns this off for a library whose folder names really are titles. The first start after upgrading reads lettered libraries again: TV files under letter folders go back to matching once, and a Fix match that covered a whole letter folder is dropped.
- **Matching.** A Fix match wins, then an id in a name or in a Radarr NFO (`movie.nfo` or `<file>.nfo`, ids only), then a search by title and year that takes only a sure answer: the same title (ignoring case, accents, punctuation and a leading article) in the same year or one either side, or the only result in the right year; a name without a year (Sonarr's show folders carry none) takes the result with its title. Two results with the same title, a remake or a show TMDB lists twice, go to the more popular one. Anything else is **Not matched**; raven never guesses at a different title. A library's type steers which result that is: an Anime library takes Japanese animation first, then any animation, then anything else with the title; a Family library takes family films and animation first; and a Documentaries library takes documentaries first. So `Cowboy Bebop/` is the 1998 anime in an Anime shows library, and the more popular 2021 series in a TV shows one. Matching needs only the name, so new files match while they are still being probed.
- **One card per movie.** A movie kept in two qualities is one card, its best version (most pixels, then biggest file), saying how many there are; the page lists them all, each playable.
- **Shows.** A show is matched once per show folder, and each season fetched once; every file links to its episode (both, for a two-episode file). An episode TMDB does not list (another order, or absolute numbering) still sits under its show and season with the name its file gave. A TV library's cards are its shows, with the years, how many episodes are on disk, and Play for the first episode not yet watched; the files no show was found for sit under **Not matched** below. The show page has its seasons and the cast over the whole run; a season page lists only the episodes on disk; an episode page has its still, air date, guest stars and file.
- **Season and episode pictures.** `Season01.jpg` or `season01-poster.jpg` in the show's or the season's folder (`season-specials-poster` for Specials) beats TMDB's season poster, and `<file>-thumb.jpg` beats an episode's still.
- **Pictures.** `poster`, `folder` or `cover`, and `fanart`, `backdrop` or `background` (`jpg`, `png`, `webp`) beside a movie win over TMDB's, as do `<file>-poster` and `<file>-fanart`; folder-wide ones count only when the folder holds that one movie. Posters are fetched as soon as a movie matches (about 60 KB each); backdrops and photos the first time they are shown. A movie's page shows its title as TMDB's logo, a PNG in your language or without text, drawn in white when it is dark; it falls back to the words when there is none or it fails. **Edit images** on a movie's or a show's page lists, on a Poster tab and a Backdrop tab (and a Logo tab of TMDB's PNG logos for a movie), every picture the movie could show, the one beside the files and all of TMDB's in your language or without text, with the current one marked, and the files that are this movie (an Extended cut beside the theatrical one), since they share the pictures. A choice is kept through refreshes; picking the one beside the files goes back to raven's own order.
- **Settings, Playback.** `/settings` holds how the server plays video, for every viewer: whether the original file plays only when the browser can take it or always; whether the server remuxes and transcodes, remuxes only, or converts nothing; the size (4K, 1080p, 720p) and quality (low, medium, high) of a transcode; which hardware encodes (auto, VideoToolbox, VAAPI, CPU only), shown against what it comes to after the test encode; and whether HDR is tone mapped. A change takes effect on the next play, and the hardware choice on the next transcode.
- **Settings, Display.** How pages look, for every viewer: **Movie titles** shows each movie's title as its logo where TMDB has one, or spells every title out in type. **Reset to defaults** puts it back with the playback settings.
- **Edit metadata.** Beside Edit images on a movie's or a show's page: the title, year, content rating, tagline and summary the page shows, each above what TMDB says. What is written shows instead of TMDB's words; TMDB's stay underneath, come back with Use TMDB's, and a refresh never touches an edit. The wand beside the title puts the file name's edition in brackets after it: `Heat (Director's Cut)`. They sit in `<data>/images/`, and the browser only ever talks to raven.
- **Ratings.** Cards show the library's chosen source (TMDB, IMDb, Rotten Tomatoes or Metacritic); the list and tile views show every score a movie or show has.
- **Fix match.** From a card's menu or the movie's page: search TMDB, pick the right one, or say it is not a movie. The results a library's type prefers, Japanese animation in an Anime library say, are listed first. The choice is kept by folder (or by file at the root of the folder its titles sit in), so renames and re-downloads keep it, and nothing automatic replaces it. For a show, Fix match on its page or on any of its files moves every file under the show's folder, keeping their season and episode numbers. A library's page and its card say how many files are not matched. **Match again**, on a library's page or its row on the Libraries page, searches TMDB once more for every file still not matched, say after a rename or once TMDB lists a new show; Fix match choices stay.
- **AI lookup.** With `ANTHROPIC_API_KEY` set (raven's own key), each show folder or movie a pass leaves not matched gets one lookup by Claude, Haiku 5.5 unless `AI_MATCH_MODEL` says otherwise. It searches TMDB itself, without the year when the folder's is wrong, checks a show's episode titles against the files', and answers with a TMDB id and how sure it is. A sure answer matches the files, and the page says **Matched by AI** with the reason; an unsure one stays under **Not matched** as a suggestion to accept or fix. Each folder is asked once; **Match again** asks again only where it chose nothing, and a Fix match always wins. raven counts its lookups against `AI_DAILY_LIMIT` (200 by default; with the default model at `low` effort, at most about 20 cents a day), and the count starts again at midnight UTC. What the day's limit skips waits for the library's next pass (a scan, a change of its type or layout, a restart or **Match again**), not for midnight. A refused key, or a model or effort Anthropic turns down, stops the lookups until a restart. Claude is sent the library's type, the folder's name inside the library, up to 12 file names, what raven read from them and the searches it tried: never a full path, and nothing from YouTube videos or Other libraries. A locked library's names are sent too: the lock hides them from browsers, not from TMDB or the lookup. `/api/health` reports `metadata.ai` (`off`, `ok` or `failing`) and `aiRemaining`; the key never reaches the browser, the logs or the health check.
- **Keeping fresh.** **Refresh details** fetches a movie or show again now, a show with its seasons. A sweep on start and every day refreshes movies and shows fetched more than 30 days ago, or 7 for those out in the last 90 or still airing. A file for an episode the stored season lacks has the season fetched again once, in case it has aired since. Movies and episodes with no file left, seasons and shows with nothing under them, people with no credits, and their pictures are cleared up.
- **TMDB's limits.** raven keeps to 20 calls a second with 4 in flight, waits out a 429, and gives each call 10 seconds. A wrong token (401) stops matching until a restart. `/api/health` reports `metadata`: whether TMDB is `off`, `ok` or `failing` (and why), and how many files wait to be matched. The token never reaches the browser, the logs or the health check.
- **Scores.** TMDB's score is always there. With `OMDB_API_KEY` set, IMDb, Rotten Tomatoes (critics) and Metacritic join it for movies and shows with an IMDb id, fetched as each is matched and topped up by the daily sweep. A free OMDb key allows 1,000 calls a day; raven counts its own (`OMDB_DAILY_LIMIT`) and waits for midnight UTC, so a big library fills over a few days. Rotten Tomatoes' audience score has no free source and is left out. Each library's **Ratings shown** setting (TMDB, IMDb or Rotten Tomatoes) picks the score on its cards and the one **Highest rated** and **Lowest rated** sort by; where that source has none, TMDB's stands in.
- **Reviews.** Up to ten reviews by TMDB members sit under a movie's or show's cast, newest first, each with the author's score as stars and **Read** for the whole review and a link to it on TMDB. They are shown as plain text, never as HTML. Rotten Tomatoes' critics' reviews have no public API, and raven's own reviews wait until rookery signs viewers in.
- **People.** Each person in a cast and crew row links to a page with their photo and everything in raven they are credited on, grouped by job.
- **Outbound calls.** These are raven's first: the container must reach `api.themoviedb.org`, `image.tmdb.org` and, with their keys, `www.omdbapi.com` and `api.anthropic.com`.

This product uses the TMDB API but is not endorsed or certified by TMDB; every page showing its data says so, with TMDB's logo.

## Thumbnails

One JPEG per video, 480px wide, generated in the background after indexing and cached as `<data>/thumbnails/<id>.jpg`. The grid shows immediately and cards fill in as thumbnails land.

- ffmpeg seeks 10% into the file with `-ss` before `-i`, which jumps to the nearest keyframe through the container index instead of decoding up to the timestamp. Measured over SMB: 0.3s for a 1080p HEVC file, against 7.5s with the slow seek.
- The `thumbnail` filter picks the most representative of the next 24 frames, which avoids fades to black.
- HDR (PQ, HLG, Dolby Vision) is tone mapped to SDR with `zscale` + `tonemap`, so thumbnails are not grey and washed out. The Docker image's Debian ffmpeg has `zscale`; Homebrew's does not, so HDR thumbnails made on a Mac in development stay washed out (`/api/health` reports `tonemap`).
- Cost: roughly 0.3 to 1.7s per file (4K HEVC is the slow end) and 20 to 30 KB per image. A library of 3,600 files takes 15 to 50 minutes the first time with the default two workers, then only new or changed files are redone.
- A run that times out (a slow or sleeping NAS) stays pending and is retried on the next scan instead of being marked failed.

## Develop

From the repo root:

```bash
bun install
bun run dev:raven   # server on :8484 (watch mode, no scan on start) and Vite on :5173, proxying /api
bun run verify         # spellcheck, TypeScript only, one command per script, lint, stylelint, format check, typecheck, tests and build for every project
```

The dev server reads `apps/raven/.env`, the file the compose file reads, so `LIBRARY_PIN`, `ADMIN_PASSWORD` and the metadata keys work the same in development. Restart it after changing the file.

`/design` shows the logo in each of its versions, the palette, every token, how each HTML element is drawn and every shared component. It is not in the side menu. Element styles live in `apps/raven/web/src/styles/elements.scss`, written in `:where()` so a component's own class always wins. The logo's files are in `apps/raven/web/public/brand`, and the favicons beside them in `public`.

Run a single target through Nx: `bunx nx run @raven/server:test`, `bunx nx run @raven/web:typecheck`, `bunx nx show project @raven/server`.

The server and core tests need `ffmpeg` and `ffprobe` on the PATH: the end-to-end suite encodes real clips and drives the API against them.

## Layout

```
apps/raven/
  server/        @raven/server: NestJS on Fastify: SQLite index, scanner, ffprobe, thumbnails,
                 range-request file serving, tracks, subtitles and converted streams, and
                 metadata: the TMDB client, matching, the image cache and the item routes
  web/           @raven/web: React 19 + Vite: libraries, the grid, list, tiles and groups, history,
                 movie pages and Fix match, the player and its stream source, the /design page
  Dockerfile, docker-compose.yml, docker-compose.vhagar.yml, vhagar-update.sh, .env.example
libs/raven/
  core/          @raven/core: API types and guards, the typed API client, the direct-play check,
                 reading names, formatting. No DOM or Node APIs, so a React Native app can use
                 it unchanged.
```

A native iOS or Android app would be another `apps/raven/` entry that imports `@raven/core` and answers the direct-play check from its own player (AVPlayer takes MKV-free HEVC and Dolby audio; ExoPlayer takes almost everything).

## Configuration

| Variable                      | Default                        |                                              |
| ----------------------------- | ------------------------------ | -------------------------------------------- |
| `PORT`                        | `8484`                         |                                              |
| `DATA_DIR`                    | `./data` (`/config` in Docker) | SQLite index and thumbnail cache             |
| `WEB_DIR`                     | unset (`/app/web` in Docker)   | Built web app to serve; unset in development |
| `BROWSE_ROOT`                 | `/` (`/media` in Docker)       | The folder picker never goes above this      |
| `SCAN_ON_START`               | `true`                         | Rescan every library on boot                 |
| `RESCAN_INTERVAL_MINUTES`     | `0`                            | Periodic rescans; `0` turns them off         |
| `PROBE_CONCURRENCY`           | `4`                            | Parallel ffprobe runs during a scan          |
| `HW_ACCEL`                    | `auto`                         | `auto`, `vaapi`, `videotoolbox` or `none`: how transcodes encode. `auto` tries VideoToolbox on a Mac and VAAPI when the render node exists, after a test encode; else libx264. Settings, Playback can override it without a restart |
| `VAAPI_DEVICE`                | `/dev/dri/renderD128`          | The GPU's render node for VAAPI              |
| `UV_THREADPOOL_SIZE`          | `16`                           | Node's file I/O threads; scans may hold four of them, so playback never waits behind a scan |
| `THUMBNAIL_CONCURRENCY`       | `2`                            | Parallel thumbnail runs                      |
| `THUMBNAIL_WIDTH`             | `480`                          |                                              |
| `FFMPEG_TIMEOUT_SECONDS`      | `90`                           | Per ffprobe or thumbnail run                 |
| `FFMPEG_PATH`, `FFPROBE_PATH` | `ffmpeg`, `ffprobe`            |                                              |
| `TMDB_API_TOKEN`              | unset                          | TMDB's API Read Access Token or API key; unset turns metadata off |
| `METADATA_LANGUAGE`           | `en-US`                        | Language for titles and summaries            |
| `METADATA_COUNTRY`            | `US`                           | Whose content rating and release date to show |
| `OMDB_API_KEY`                | unset                          | OMDb's key, for IMDb, Rotten Tomatoes and Metacritic scores |
| `OMDB_DAILY_LIMIT`            | `1000`                         | OMDb calls a day                             |
| `ANTHROPIC_API_KEY`           | unset                          | raven's own Anthropic key, for the [AI lookup](#metadata) of what matching leaves; unset turns it off |
| `AI_MATCH_MODEL`              | `claude-haiku-5-5`             | The model the AI lookup asks                 |
| `AI_MATCH_EFFORT`             | `low`                          | How hard it thinks: `low`, `medium`, `high`, `xhigh` or `max` |
| `AI_DAILY_LIMIT`              | `200`                          | AI lookups a day                             |
| `LIBRARY_PIN`                 | unset                          | The PIN that opens locked libraries          |
| `ADMIN_PASSWORD`              | unset                          | Turns the [admin lock](#admin-lock) off; 10 characters or more, mixing cases, a digit and a symbol. Unset or weaker, the lock stays on |

## Not there yet

- No accounts or auth: keep it on the LAN or behind Tailscale.
- Picture subtitles (PGS, VobSub) would need burning in or OCR.
- On VAAPI, HDR is converted to BT.709 on the GPU rather than tone mapped. That suits HLG; HDR10 (PQ) comes out flat.
- No QSV; Intel GPUs go through VAAPI.
