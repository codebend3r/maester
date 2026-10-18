<picture>
  <source media="(prefers-color-scheme: dark)" srcset="web/public/brand/raven-mark-on-dark.svg">
  <img src="web/public/brand/raven-mark-on-light.svg" alt="" width="88">
</picture>

# raven

A light, self-hosted video library and player. Point it at folders of videos; it indexes them, makes a thumbnail for each, and plays them in the browser straight from disk, converting on the fly only what the browser cannot play.

raven is the `apps/raven/` folder of an Nx workspace; the [root README](../../README.md) covers the workspace.

## Run it with Docker

1. Edit the volumes in `apps/raven/docker-compose.yml` so each media folder is mounted read-only under `/media`.
2. Copy `.env.example` to `.env` beside the compose file and set `ADMIN_PASSWORD`: adding a library, like anything else that changes raven, needs the [admin lock](#admin-lock) off, and only the password turns it off. For posters and details in Movies libraries, set `TMDB_API_TOKEN` too (see [Metadata](#metadata)); without it raven works as before.
3. From `apps/raven/`, `docker compose up -d --build`. The image builds from the repo root, where the workspace's `bun.lock` lives.
4. Open `http://<host>:8484`, turn the admin lock off at the foot of **Settings** with that password, choose **Add library**, and pick folders under `/media` with the folder browser.

Deleting a video from the app removes the file, so leave `:ro` off any mount where that should work. On a read-only mount the app keeps the video and says why. Deleting needs the [admin lock](#admin-lock) off, which needs `ADMIN_PASSWORD` in `.env`.

The index and thumbnails live in `./data` (mounted at `/config`). The image runs as the unprivileged `node` user (1000:1000); on a Synology, set `user:` in the compose file to the owner of `./data`.

### Running on Vhagar

raven runs on Vhagar, the NAS with an Intel GPU, from `docker-compose.vhagar.yml`, which lives there as `/volume1/docker/raven/docker-compose.yml`. Every NAS's share is mounted read-write under `/media/<nas>`: Vhagar's own share directly, the other four through the cifs mounts Vhagar already has of them in `/volume1/Vhagar/`. Each share also holds folders for the others, so pick a library's folders inside one share rather than a whole share.

Merges to `main` deploy themselves:

1. The main smoke test builds the image with the merge's build version (`X.Y.Z.N`, the tag it gets), checks `/api/health`, and pushes it to `ghcr.io/codebend3r/raven` as `latest`, as the version and as the commit. Every merge publishes, even one that left raven's code alone, since the version it carries is the one raven's side menu shows.
2. On Vhagar, DSM's Task Scheduler runs `vhagar-update.sh` (there as `update.sh`) as root every five minutes. It pulls `latest`, and when that is not the image raven runs, stops raven, copies `data/raven.db*` to `backups/<time>/` (the last five are kept), and starts the new image. It writes what it did to `update.log`.

Nothing on Vhagar takes instructions from GitHub, and GitHub holds no NAS credentials: Vhagar only pulls a public image.

To set the task up, in DSM: **Control Panel → Task Scheduler → Create → Scheduled Task → User-defined script**. Name it `raven update` and run it as `root`; on **Schedule**, run daily, every 5 minutes, from 00:00 to a last run time of 23:55 (left at 00:00, it runs only just after midnight); on **Task Settings**, the script is `bash /volume1/docker/raven/update.sh`. DSM asks for your password, as it does for every task that runs as root.

To go back to an earlier build, set `image:` to `ghcr.io/codebend3r/raven:<commit>` and run `update.sh`; put `latest` back to follow `main` again. A backup's files go back into `data/` with raven stopped.

Without GitHub, the image can still be built on a Mac and loaded on Vhagar. Vhagar's docker has no buildx, which the Dockerfile needs. From the repo root:

```bash
docker buildx build --builder desktop-linux --platform linux/amd64 -f apps/raven/Dockerfile -t ghcr.io/codebend3r/raven:latest --load .
docker save ghcr.io/codebend3r/raven:latest | gzip -1 | ssh vhagar 'cat > /volume1/docker/raven/raven-image.tar.gz'
```

Then, on Vhagar, `sudo docker load -i /volume1/docker/raven/raven-image.tar.gz` and `sudo docker compose up -d` in `/volume1/docker/raven/`. Pause the task first, or its next run puts `latest` from GHCR back.

### Public through Tailscale Funnel

The compose file's `tailscale` service puts raven on the internet at `https://raven.<tailnet>.ts.net` with [Tailscale Funnel](https://tailscale.com/kb/1223/funnel). It runs in a container of its own and proxies to raven over the compose network, so a new raven image never restarts it. It sits in the `funnel` profile, and `update.sh` starts it only once `funnel/serve.json` is there, so until then raven stays on the LAN.

Anyone with the address can browse and play every library that is not locked. Set `ADMIN_PASSWORD` first: the [admin lock](#admin-lock) is what keeps them from changing anything, and without the password it also stays on for you. Make `LIBRARY_PIN` long, too: five wrong tries a minute still lets a stranger make 7,200 a day, enough to run through a four-digit PIN in under two days.

1. In the Tailscale admin console, generate a one-off auth key (**Settings → Keys**, not reusable). The tailnet's policy must give the node the `funnel` attribute, as it already does for the tailnet's other Funnels.
2. Put it in Vhagar's `.env` as `TS_AUTHKEY`, beside `ADMIN_PASSWORD`.
3. Stage the serve config and the compose file, and run the update:
   ```bash
   ssh vhagar 'mkdir -p /volume1/docker/raven/funnel'
   ssh vhagar 'cat > /volume1/docker/raven/funnel/serve.json' < apps/raven/vhagar-funnel.json
   ssh vhagar 'cat > /volume1/docker/raven/docker-compose.yml' < apps/raven/docker-compose.vhagar.yml
   ```
   Then, as root, `bash /volume1/docker/raven/update.sh`.
4. Once `raven` shows in the admin console, turn off its key expiry there and take `TS_AUTHKEY` out of `.env`. The sign-in stays in `tailscale/`.

To take raven off the internet, delete `funnel/` and, as root in `/volume1/docker/raven`, run `docker compose --profile funnel rm -sf tailscale`.

### On Netlify

The web app can also be served from Netlify, with `/api` proxied to the Funnel address, so a page there works as it does on Vhagar, the PIN and the admin lock included: the browser only ever talks to Netlify, so their cookies stay first party.

1. Create a site from the GitHub repo. Leave the base directory empty, the repo root, and set the package directory to `apps/raven/web`. Its `netlify.toml` holds the build command, the publish folder, Bun's version and the single-page app's fallback.
2. In the site's environment variables, set `RAVEN_API_ORIGIN` to the Funnel address, `https://raven.<tailnet>.ts.net`. The build writes it into a `_redirects` file, and fails on Netlify without it.
3. So the side menu shows the build number (`X.Y.Z.N`) and not `package.json`'s `X.Y.Z`, add a build hook under Build & deploy, Build hooks, for `main`, and save its URL as the repo secret `NETLIFY_BUILD_HOOK`. Netlify builds a push before CI has tagged it, so after the tag exists `main-smoke-test.yml` calls the hook, and `netlify-build.sh` (the build command) bakes the tag on that commit into the build as `VITE_RAVEN_VERSION`. Until the secret exists the `netlify` job warns and skips, and the site keeps `X.Y.Z`.

#### The control plane and the media plane

Netlify carries the control plane: the JSON, the pictures, the cookies and the live events, all through `/api`. The video, the original file and the subtitles are the media plane, and they go straight from the browser to Vhagar over the best origin it can reach, so playback does not count against the site's bandwidth. The same `/api` proxy stays as the fallback.

- **Three variables on Vhagar** turn it on, all in the [Configuration](#configuration) table: `RAVEN_MEDIA_ORIGINS` lists the origins, best first, as `kind:url` (`lan`, `tailnet` or `public`); `RAVEN_WEB_ORIGINS` names the web app origins allowed to call the media routes, your Netlify site and, with one `*` in its first hostname label, its deploy previews; `RAVEN_MEDIA_SECRET` signs the tickets. With `RAVEN_MEDIA_ORIGINS` unset, nothing changes.
- **The probe.** When the app opens, and again when the network comes back or the tab returns after a long absence, the browser fetches 256 KB from each origin and picks the one that answers best, preferring `lan` over `tailnet` over `public` when they are close. It keeps the pick in `sessionStorage` for 10 minutes, and probes again if a stream cannot reach it.
- **The ticket.** The page asks raven through Netlify for a ticket, which stands in for the PIN cookie on the media origin, whose cookies Netlify's page cannot send. A ticket is good for 6 hours and for one video, sets no cookie and opens nothing else. The link that "Copy file link" copies carries it too, so it plays in VLC or IINA for those 6 hours.
- **The fallback.** When no origin answers, or none is set, the player uses `/api` through Netlify as before. Thumbnails and JSON always do.

What Vhagar needs for each kind:

- `lan`: a DSM reverse proxy rule, or Caddy, for `raven.home.<domain>` to `raven:8484`; a certificate for that name by DNS challenge; and a local DNS record, on the router or in DSM's DNS Server, pointing the name at Vhagar's LAN IP. It has to be https, since the Netlify page is, and a plain `http://` LAN address is blocked as mixed content.
- `tailnet`: Tailscale Serve already terminates TLS for the `ts.net` name inside the tailnet. Confirm the viewing devices are on the tailnet and that the ACL lets them reach the `raven` node on 443.
- `public`: unchanged, the Funnel address.

The first time a public page reaches a LAN address, Chrome asks to allow access to devices on the local network. Allow it, or the `lan` origin never answers and the probe moves on to the next one.

To try it on one machine, put this in `apps/raven/.env`, run `bun run dev:raven`, and open Vite at `http://localhost:5173`:

```bash
RAVEN_MEDIA_ORIGINS=lan:http://localhost:8484
RAVEN_WEB_ORIGINS=http://localhost:5173
RAVEN_MEDIA_SECRET=$(openssl rand -base64 32)   # paste the value; .env does not expand $(...)
```

Play a clip and open the browser's Network tab: the `stream` request goes to `http://localhost:8484/api/media/<id>/stream?...&t=...` and its response carries `access-control-allow-origin: http://localhost:5173`, while `tracks` and the thumbnails stay on `:5173`. Stop the server and reload, and the player falls back to the relative `/api` URL.

#### What still goes through Netlify

Netlify gives a proxied request 26 seconds to start answering, and counts its bandwidth. raven marks its pictures `private`, so Netlify's cache never keeps one that the PIN opened for a single browser. raven compresses its JSON and subtitles with Brotli, or gzip for a browser that offers nothing better, so the Movies listing of about 3 MB leaves raven as about 360 KB; video, JPEG and PNG pictures, and live updates go as they are. Whether Netlify's proxy passes the compressed answer on to the browser is still to be checked: `curl -s -o /dev/null -D - -H 'Accept-Encoding: br' https://<site>/api/libraries` should show `content-encoding: br`. It has to be a GET, since raven answers a HEAD of an API route uncompressed.

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

Converted streams are fragmented MP4 fed to the browser through Media Source Extensions (`ManagedMediaSource` on iOS). ffmpeg keeps the file's own timestamps (`-copyts -start_at_zero`, `frag_discont`, no edit list), shifted by one second so nothing goes negative, so a stream started anywhere lands at the right place on one timeline. Seeking inside what is buffered is instant; seeking outside it starts a new stream there, and the server kills the old ffmpeg as soon as its request closes. Fragments are capped at roughly one second even when a remux copies a file with widely spaced keyframes, so playback does not have to wait for a whole source GOP to arrive. The player reads at most a minute ahead, which holds ffmpeg back through the pipe, and prunes old frames in batches even when delivery stays below that limit. It normally retains about thirty seconds behind the playhead, shrinking that to five seconds when the browser reports a full media buffer. Retaining thirty seconds under memory pressure can otherwise stall playback permanently before there is anything the player is willing to remove. Seeking or closing the player cancels any buffer-space wait.

While nothing holds the reading back, the player also times how much video arrives against the clock. When a remux arrives slower than it plays, measured over fifteen seconds with less than ten seconds buffered ahead, the connection cannot carry it, and the player steps down to a transcode from the same spot instead of stalling every few seconds. A 4K HDR remux of a Blu-ray runs 70 to 80 Mb/s, more than Wi-Fi a room or two from the router often carries, while the 1080p transcode needs about 4 Mb/s. The step holds for the rest of that playback, audio track changes included, and the Playback menu and Playback info say what the connection carried against what the remux needed.

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

Playback resumes where you stopped; reaching the library's **Watched at** (95% by default) counts as finished and clears the spot, so the next play starts from the top.

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

## Home and search

Home lists what is being watched, then a row of each pinned library's newest arrivals. The search beside its title looks through every library, pinned or not, by title (the same match a library's own search makes), and shows what it finds in place of those rows: a row for each library holding a match, its first 16 by title, whose heading opens that library on the same search to list them all. A locked library stays out until the PIN opens it. The search rides in the address (`/?q=heat`), so Back from a result lands on it again, and Home in the side menu clears it.

Every search box, on Home, a library's page and in Fix match, searches once typing pauses for a fifth of a second rather than on each keystroke; Enter, or Fix match's **Search**, searches at once.

## Library settings and views

Each library keeps its own settings on the server, so every browser opens it the same way.

- **Type**: Movies, TV shows, Anime movies, Anime shows, Family movies, Family TV shows, Documentaries, Sporting events, YouTube videos or Other. New libraries, and those made before types, are Other. It shows beside the video count, gives the library its icon until it picks another (see **Icon**), and can be changed in **Edit** at any time. A Movies, Anime movies, Family movies, Documentaries or Sporting events library reads its files' names and matches them to TMDB movies, as Radarr files documentaries and as TMDB lists events like UFC cards, and a TV shows, Anime shows or Family TV shows library to TMDB shows (see [Metadata](#metadata)). YouTube videos are not on TMDB, so they keep plain file names like Other. Changing the type matches the files again, or goes back to plain file names; Fix match choices stay. Between two types matched to movies, or two matched to shows, each file is picked again where it stands, so the cards stay up meanwhile and a file that keeps its movie or show keeps its split and edited metadata. Only a change between two types that are never matched (YouTube videos and Other) leaves the files as they are.
- **Icon**: the one the library wears in the side menu, beside its name on its page and on the Libraries page, picked in **Edit** from 24 that span films and shows, sport (UFC, basketball, soccer, American football) and audio (music, lossless music, podcasts, audiobooks). Until one is picked, the library wears its type's, and changes with it; one picked, the type's own included, stays through a change of type.
- **Save where each video stopped**, on by default: leave a video and come back to pick up where it stopped. Turned off, nothing new is saved and nothing resumes, but saved spots are kept for when it is turned back on.
- **Pin to the side menu**, on by default: the library gets its own link under Home and Favourites, above Libraries and Settings, which keep to the foot of the menu (the end of the row on a narrow screen). Pin or unpin from the Libraries page, or in **Edit**. Libraries whose videos are mostly 4K come first, there, on the Libraries page and on Home, then the rest by name.
- **Watched at**, 95% by default: how far into a video playback must get for it to count as watched, as a whole percentage from 1 to 100. It is also where the resume spot clears, so a play that counts as watched never leaves a spot; set low, a library gives up its spot early (at 50%, halfway). Libraries still at the old default of 90 moved to 95, and a spot already at or past its library's percentage was cleared with it; a video last stopped between 90% and 95% is in progress again.
- **Refresh automatically**, on by default: raven takes in videos as they are added, removed or renamed, without a rescan, two ways at once. It watches the library's folders: changes gather until the folders have been still for two seconds (a copy in progress keeps them busy), then only the places that changed are looked at again, and every open page updates on its own. And every `QUICK_SCAN_INTERVAL_MINUTES` (10 by default; 0 turns it off) it runs a **quick scan**: every folder is read again, but only the files the index does not know are stat'ed and probed, so a settled library costs a directory listing and nothing more. Either way a renamed or moved file stays the same video: its progress, favourite, history, match and thumbnail go with it, and its changed date moves on. The watch sees a video replaced under its own name; the quick scan cannot (its folder looks the same), so a library whose share does not report its changes needs a rescan for that. On Linux each folder takes one inotify watch; a library that cannot be watched (a share that went away, or a system out of watches, see `fs.inotify.max_user_watches`) is left to its quick scan, and watched again the next time a library is saved. A network share mounted from another machine never reports changes made elsewhere, so there the quick scan is what keeps the library current. A **full scan**, which reads every file, runs only on **Rescan**, when a library is added, or when its folders change, and never on a timer; with `SCAN_ON_START` every library gets a quick scan on boot. Each library says when its last full scan and its last quick scan finished, and remembers both across restarts.
- **Lock with the PIN**, off by default: a private library. Its videos, their files, thumbnails and paths, its history, and its movies and shows stay behind `LIBRARY_PIN` until the PIN is entered; the server answers `423 Locked` until then, so no page or player can reach them. Entering it opens every locked library in that browser for 12 hours, until **Lock** on the library's page, or until the server restarts. Any type of library can be locked, and the lock stays through a change of type. Locked libraries keep their name and their icon in the side menu, with a small lock on the icon, and drop out of Favourites and cast pages while locked. On the Libraries page a locked library shows only its name, type and counts: its folders, the picture of its newest video and what its last scan said about its folders stay on the server, and **Edit** asks for the PIN. Once the PIN is entered it shows like any other library, marked Unlocked. Five wrong PINs in a row make it wait a minute. Without `LIBRARY_PIN` no library can be locked, and one already locked stays shut. All of this is with the [admin lock](#admin-lock) off; while it is on, locked libraries are not there at all, and none can be locked.
- **Sort**: title, recently or oldest added, recently changed (found, renamed, moved or replaced), largest or smallest file, highest or lowest bitrate, highest or lowest resolution (by pixel count), newest or oldest release (libraries matched to TMDB), or random. Videos not yet probed, and files with no year, go last. Titles sort without a leading "The", "A" or "An". Random holds its order while the page is open, and each visit starts a fresh deal.
- **View**: a grid of cards, a list, tiles (rows with a small thumbnail), or grouped: by matched or not (a library matched to movies starts here, Matched above Not matched, so what needs a Fix match is in one place), resolution, video codec or month added. Each bucket is a folded row with its count; click it to open the cards. The page of a library matched to shows splits the same way, its shows under a Matched row and the leftover files under Not matched, both folded to start.

Libraries never mix on a movie's or an episode's page. One kept in two libraries, a 4K library and another say, has a page in each showing only that library's files, with its count of files, its versions and Play keeping to them. A link from a library, its cards, Home, Favourites or History opens the page as that library shows it (`/movies/79?library=4`); a link that names no library, as a person's credits, keeps to the library of the file Play would start (the one in progress, else the best). Edit images still lists every file the pictures go with, since a movie's pictures are its own in every library.

Sort, view and grouping are picked on the library page and saved as they change; the others are in **Edit**. Changing a setting or the name never rescans; only a change of folders does. Sort, view, grouping and the pin can be changed with the [admin lock](#admin-lock) on, and the change holds for every browser; **Edit** needs it off.

In every library and view, a strip runs down the right edge of the screen and stays there as the page scrolls, stepping through whatever the listing is sorted by, in its order: the alphabet for titles (a title files under its letter without a leading "The", "A" or "An", and # holds the ones that start with no letter), round steps of bitrate under Mb/s or of size under GB, resolutions, years (decades over a wide span), whole scores in the library's source, and months (years over a wide span) for when videos came or changed. Values not known yet sit under ? at the end. A step jumps to the first card under it in the order shown, opening a folded bucket on the way; a step no card falls under is there but cannot be pressed. A TV library steps its bitrate every 5 Mb/s, each show by its files' mean bitrate, and spells out titles for size and resolution, which its shows sort by title for. A random order has no strip, and neither has a TV library sorted by when videos changed.

Beside the sort, **Play** starts the first video as the page shows it (the top of the first group in the grouped view) and **Shuffle** starts a random one, whatever the sort. Both keep to the search.

## Library tabs

A library's page opens on **All**, its listing with the search, sort and view above. Tabs beside it each have an address of their own under the library's (`/libraries/4/sagas`), so they can be linked to and the back button steps between them, and each reads only what it shows:

- **In progress**: the videos left partway through, the most recently watched first. Empty in a library that does not save where videos stop.
- **Favourites**: the library's own favourites, most recently marked first.
- **Sagas**, in a library matched to movies: the movies gathered by the TMDB collection they belong to (The Lord of the Rings Collection, say), by name, each a deck of its posters, the first movie on top, with how many there are and the years they span. Pointed at or focused, a deck fans out like a hand of cards; it opens the saga's own page (`/libraries/4/sagas/119`), with its movies oldest first to pick one to watch. Behind its title the saga's page shows each movie's backdrop in turn, first to last and round again, and pointing at a movie leaves that backdrop up rather than bringing the movie's in. **Edit backdrop**, with the admin lock off, picks how each comes in (a crossfade, a slow Ken Burns zoom, or a slide), or turns the slideshow off and holds one movie's backdrop still; each library keeps its own pick for each saga. A browser that asks for less motion holds the slideshow still. **Play all** plays the movies one after another: as each ends the next starts, the player stays full screen, and **Next** skips ahead. A collection shows once two of its movies are in the library. Movies matched before sagas were kept learn theirs in the sweep on start, one light call each, with no scores fetched again.
- **Not matched**, in a matched library: the files no movie or show was found for, or still waiting, each with **Fix match** in its menu.
- **Duplicates**, in a library matched to movies: every movie with more than one file, each file with the cut its name reads as (what the name says past the title, year and release, `Alexander 2004 Revisited the Final Cut (2004)` being `Revisited the Final Cut`), else Standard. **Split apart** gives every file a card of its own, titled with its cut or its release (`300 (WEBDL-2160p)`); **Smart split apart** gives each cut its own card and keeps copies of one cut together, so `Alexander (Revisited the Final Cut)` stands beside `Alexander`, which keeps the Remux and the WEBDL. A split movie stays in the list as its separate cards, any that still holds several files splittable again, with **Put back together** to combine them. A split is kept on the files, so rescans and renames keep it; a file found later joins the movie's own card. A split card opens the movie's page on its own file (`/movies/7?file=11`), so Play starts that cut.
- **Recently finished**: the last 48 videos that count as watched, by the library's **Watched at** setting or because they were marked watched, each with the day it last played or was marked, and a link to the full [History](#history).

A tab the library's type has no use for, as after a change of type, opens All instead. A locked library shows no tabs until the PIN is entered.

## History

Each library's **History**, linked from its page and its row on the Libraries page, lists the videos played or marked in it, last played first and split into days. **Watched** shows the ones that count as watched; **All played** adds the ones that stopped short, with how far they got.

- A play is recorded when a video starts, and its furthest point as the player saves its position (every 10 seconds, on pause, and on leaving). Starting the same video again within half an hour of its last report is the same play.
- A video counts as watched once any play gets to the library's percentage, or when it is marked watched. One whose length is not known yet counts only by a mark.
- A play is one of three kinds: a real play (which counts), a mark that **Mark as watched** wrote (which always counts, and shows as "Marked watched" with no play counted), or a real play that **Mark as unwatched** set aside. A set-aside play stays in the history, counted among the plays, but never counts as watched and its furthest point is not shown; marking unwatched is a clean slate, and only plays after it count. Playing a video again after that starts a new play.
- History is kept whatever **Save where each video stopped** says; that setting is only about resuming. A video's plays go when the video leaves the library.

## Marking watched

A watched video's card carries a check in the corner of its picture (and beside its title in a list), and a card in progress keeps its resume bar; one watched and then started again shows both. A show, season or saga card shows a check when everything in it is watched and the number left unwatched when some of it is, and nothing when none is; a screen reader hears "Watched" or "6 unwatched episodes". History tiles leave the check off, since their note already says.

**Mark as watched** and **Mark as unwatched** in a card's menu mark that video's card: the files of a movie that share it, or the file by itself. A movie's or episode's page has a **Watched** button beside the favourite heart. The show, season and saga pages have one too, which reads as partly pressed when some of what they hold is watched: pressing it marks everything watched, and pressing it again marks everything unwatched. Each episode on a season page has its own **Watched** button. A video marked shows at once; a show, season or saga shows once the server has answered, since its counts and next episode come from there.

**Select mode** marks many at once. **Select** starts it: in a library's toolbar on **All**, in a small header on **In progress**, **Favourites**, **Recently finished** and **Sagas**, and beside Play on a saga, show or season page. On a screen with a pointer, each card also shows a checkbox when pointed at, and ticking it starts select mode with that card selected. While selecting, a click on a card selects or deselects it instead of opening it, a shift-click selects every card between the last one clicked and this one in the order they show (a sorted list included; cards folded away in a closed bucket are skipped), and each card has one tab stop, its checkbox. A bar at the foot of the page counts the selection and offers **Select all** (closed buckets included), **Mark watched**, **Mark unwatched**, **Clear** and **Done**. Marking sends the whole selection in one request, and the bar then says "Marked 12 watched"; the selection stays, so the other button reverses it, and a failure keeps it too. **Done** and Escape end select mode, as does leaving the page or changing tab; focus goes back to **Select**. A file marks its card, a show or season card marks everything under it, an episode row marks the episode, and a saga marks its movies, so the kinds mix freely. Home, the History page, people pages and search results have no select mode.

## Favourites and deleting

Every card has a menu, from the button in its corner or a right click; on a screen with a pointer, the button shows when the card is pointed at or focused. **Favourite** marks the video and lists it under **Favourites** in the side menu, most recently marked first, across every library. The player has the same heart at the top, beside the video's title, so a video can be marked while it plays: pressing it marks or unmarks the video without stopping it, and the heart fills once it is a favourite. **Mark as watched** (or **Mark as unwatched**, once it is) comes next and, like Favourite, is there with the admin lock on; see [Marking watched](#marking-watched). The rest of the menu needs the [admin lock](#admin-lock) off. In a matched library it has **Fix match** and **Refresh details** (see [Metadata](#metadata)), and on a matched movie or episode **Edit images**, which opens the movie's (or the episode's show's) pictures in a dialog over the page, the same as **Edit images** on its page. It ends with where the file lives, and choosing it copies the path. **Delete** asks first, then removes the file from disk and the video from the index, along with its thumbnail, progress and favourite. There is no undo.

## Admin lock

The admin lock keeps what only an admin should do out of every other browser's reach. It is on in every browser until the admin password is entered there, and while it is on:

- Locked libraries are not there at all: not in the side menu, on the Libraries page, on Home, in Favourites or on a cast page, and an address of one answers as if there were no such library, so nothing asks for the PIN. No library can be locked either, as it would drop out of sight.
- raven can be watched, not managed. No library can be added, edited, deleted, rescanned or matched again, and the server's folders cannot be browsed. No Fix match, AI suggestion, **Refresh details**, **Edit metadata** or **Edit images** can be saved, and no duplicate split apart or put back together. **Playback** and **Display** in **Settings** can be read but not changed. The buttons and menu items for all of this are left out, and the server answers `403` to them.
- A library's sort, view, grouping and pin still change: its page and the Libraries page save them through a route of their own, `PUT /api/libraries/:id/view`, which takes nothing else.
- No video can be deleted, and no file's path is shown: the card menu leaves out **Delete** and where the file lives, and the server answers `403` to both.

The toggle is at the foot of **Settings**. Turning it off asks for `ADMIN_PASSWORD` and holds in that browser only, until it is turned on again there: a refresh, a closed browser, a server restart or a redeploy leaves it off. The browser keeps its cookie for 400 days, renewed each time a page reads the lock. Changing `ADMIN_PASSWORD` turns the lock back on in every browser, the way to shut out one that should no longer have it. The cookie is signed with a secret raven makes once and keeps in its database (in `DATA_DIR`), so starting from an empty data folder turns it back on too. Turning it on waits 15 seconds before it holds, with the seconds counting down beside it; unticked again in that time, it goes off with no password, so a slip of the finger costs nothing. Five wrong passwords in a row make it wait a minute.

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
- **Pictures.** `poster`, `folder` or `cover`, and `fanart`, `backdrop` or `background` (`jpg`, `png`, `webp`) beside a movie win over TMDB's, as do `<file>-poster` and `<file>-fanart`; folder-wide ones count only when the folder holds that one movie. Posters come 185, 342 and 500 px wide (about 16, 43 and 80 KB) and are fetched at all three as soon as a movie matches; a card asks for the narrowest its screen shows sharp, and a movie's page for the widest. Backdrops and photos are fetched the first time they are shown. A movie's page shows its title as TMDB's logo, a PNG in your language or without text, drawn in white when it is dark; it falls back to the words when there is none or it fails. **Edit images** on a movie's or a show's page lists, on a Poster tab and a Backdrop tab (and a Logo tab of TMDB's PNG logos for a movie), every picture the movie could show, the one beside the files and all of TMDB's in your language or without text, with the current one marked, and the files that are this movie (an Extended cut beside the theatrical one), since they share the pictures. A choice is kept through refreshes; picking the one beside the files goes back to raven's own order.
- **Settings, Playback.** `/settings` holds how the server plays video, for every viewer: whether the original file plays only when the browser can take it or always; whether the server remuxes and transcodes, remuxes only, or converts nothing; the size (4K, 1080p, 720p) and quality (low, medium, high) of a transcode; which hardware encodes (auto, VideoToolbox, VAAPI, CPU only), shown against what it comes to after the test encode; and whether HDR is tone mapped. A change takes effect on the next play, and the hardware choice on the next transcode. Changing them needs the [admin lock](#admin-lock) off.
- **Settings, Display.** How pages look, for every viewer: **Movie titles** shows each movie's title as its logo where TMDB has one, or spells every title out in type. **Reset to defaults** puts it back with the playback settings.
- **Edit metadata.** Beside Edit images on a movie's or a show's page: the title, year, content rating, tagline and summary the page shows, each above what TMDB says. What is written shows instead of TMDB's words; TMDB's stay underneath, come back with Use TMDB's, and a refresh never touches an edit. The wand beside the title puts the file name's edition in brackets after it: `Heat (Director's Cut)`. They sit in `<data>/images/`, and the browser only ever talks to raven. On a movie's page, Edit metadata starts with the names of the files on the movie's card, counted once there are two or more. **Split apart** there gives every one of them a card of its own in the library, as it does under Duplicates, so a file that is another movie can be put right with Fix match on its own page; once split, the movie's other cards are listed as links, with **Put back together**. A movie's page shows one card's files: a split card's link names its file.
- **Ratings.** Cards show the library's chosen source (TMDB, IMDb, Rotten Tomatoes or Metacritic); the list and tile views show every score a movie or show has.
- **Fix match.** From a card's menu or the movie's page: search TMDB, pick the right one, or say it is not a movie. raven scores how sure it is of each result, from 0 to 100, by its title, its year, how well it fits the files on disk (their episodes, or a movie's length) and its popularity, and lists them best first; among equals, the results a library's type prefers, Japanese animation in an Anime library say, come first. A country typed after the title, `The Office (UK)`, picks that country's show rather than being searched for. The choice is kept by folder (or by file at the root of the folder its titles sit in), so renames and re-downloads keep it, and nothing automatic replaces it. For a show, Fix match on its page or on any of its files moves every file under the show's folder, keeping their season and episode numbers. A library's page and its card say how many files are not matched. **Match again**, on a library's page or its row on the Libraries page, searches TMDB once more for every file still not matched, say after a rename or once TMDB lists a new show; Fix match choices stay.
- **AI lookup.** With `ANTHROPIC_API_KEY` set (raven's own key), each show folder or movie a pass leaves not matched gets one lookup by Claude, Haiku 5.5 unless `AI_MATCH_MODEL` says otherwise. It searches TMDB itself, without the year when the folder's is wrong, checks a show's episode titles against the files', and answers with a TMDB id and how sure it is. A sure answer matches the files, and the page says **Matched by AI** with the reason; an unsure one stays under **Not matched** as a suggestion to accept or fix. Each folder is asked once; **Match again** asks again only where it chose nothing, and a Fix match always wins. raven counts its lookups against `AI_DAILY_LIMIT` (200 by default; with the default model at `low` effort, at most about 20 cents a day), and the count starts again at midnight UTC. What the day's limit skips waits for the library's next pass (a scan, a change of its type or layout, a restart or **Match again**), not for midnight. A refused key, or a model or effort Anthropic turns down, stops the lookups until a restart. Claude is sent the library's type, the folder's name inside the library, up to 12 file names, what raven read from them and the searches it tried: never a full path, and nothing from Sporting events, YouTube videos or Other libraries. A locked library's names are sent too: the lock hides them from browsers, not from TMDB or the lookup. `/api/health` reports `metadata.ai` (`off`, `ok` or `failing`) and `aiRemaining`; the key never reaches the browser, the logs or the health check.
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
bun run dev:raven   # shared player build watcher, server on :8484 (watch mode, no scan on start) and Vite on :5173, proxying /api
bun run verify         # spellcheck, TypeScript only, one command per script, lint (gale for the SCSS), format check, typecheck, tests and build for every project
```

The dev server reads `apps/raven/.env`, the file the compose file reads, so `LIBRARY_PIN`, `ADMIN_PASSWORD` and the metadata keys work the same in development. Restart it after changing the file.

`/design` shows the logo in each of its versions, the palette, every token, how each HTML element is drawn and every shared component. It is not in the side menu. Element styles live in `libs/raven/ui/src/styles/elements.scss`, written in `:where()` so a component's own class always wins. The logo's files are in `apps/raven/web/public/brand`, and the favicons beside them in `public`.

The player is built from `libs/raven/ui`, not copied into the web app. Both clients import its built exports and `@raven/ui/styles.css`. Its [library README](../../libs/raven/ui/README.md) documents peers, exports and tests. `dev:raven` also watches the library bundle.

Run a single target through Nx: `bunx nx run @raven/server:test`, `bunx nx run @raven/web:typecheck`, `bunx nx show project @raven/server`.

The server and core tests need `ffmpeg` and `ffprobe` on the PATH: the end-to-end suite encodes real clips and drives the API against them.

## raven player (macOS)

raven player is raven's player as a Mac app, for Apple Silicon. It plays videos from your own disk under the same controls as the web, through libmpv rather than the browser, so MKV, HEVC, Dolby audio, DTS and TrueHD all play as they are, with no remux or transcode. It also plays a raven server's titles handed to it from raven web. It does not browse a library yet; the web does that.

### Install it

Each release (`vX.Y.Z`) on the repo's [Releases page](https://github.com/codebend3r/maester/releases) carries four assets: `raven-player-<version>-arm64.dmg`, the same app as `raven-player-<version>-arm64.zip`, `raven-player-<version>-sources.tar.gz` (the sources of libmpv and every library it is built from) and `SHA256SUMS`. Pick the newest entry with three numbers, such as `v0.6.0`. The `vX.Y.Z.N` entries, the one marked Latest among them, are builds of each merge and carry no app.

1. Download the dmg (or the zip) and `SHA256SUMS`, and check them in Terminal, in that folder: `shasum -a 256 -c SHA256SUMS --ignore-missing`. Each file you downloaded says `OK`.
2. Open the dmg and drag raven player to Applications (or unzip the zip and move raven player there).
3. Open it. The first time, macOS says it cannot verify the app, because raven player is signed ad hoc rather than by an identified developer. Open System Settings, then Privacy & Security, and choose Open Anyway beside raven player; macOS asks you to confirm, then for an administrator's password. You do this once.

If you would rather use Terminal for step 3, `xattr -dr com.apple.quarantine "/Applications/raven player.app"` removes the download's quarantine, and the app then opens without asking.

The app keeps its settings, servers, recents and resume points in `~/Library/Application Support/raven`.

### Open a video

- **Open** (Command O), or the button on Home, picks a video. **Drop** one or more videos on the window: the first plays and the rest follow it, in the order dropped.
- **From Finder:** Open With, raven player, or drop a video on the Dock icon. raven player registers for movie types at `Alternate` rank, so installing it changes nothing Finder does until you say so: hold Option in Finder's Open With menu for Always Open With, or use Get Info, Open with, raven player, Change All.
- **Open Recent** in the File menu, and the recents on Home (the last 50, each with how far you got). A local file resumes where it stopped.
- **Next in folder:** when a local video ends, the next one in its folder (by natural order, so `Episode 2` before `Episode 10`) plays, and Next shows it as soon as playback starts.

### Servers and handoff

- **Add a server** in Settings, by its address (`https://raven.<tailnet>.ts.net`), or by following a link to it. Either way raven player asks first, in a dialog of its own, "Add the raven server at ...?", and fetches nothing before you agree. It keeps at most 20; removing one signs raven player out of it.
- **A session per server:** each server's cookies stay in that server's own session, so one server's unlock never reaches another, and the page never holds them.
- **Locked libraries** ask for the PIN, after the admin password when that server's admin lock is on. The unlock lasts while raven player runs, so a relaunch asks for the PIN again.
- **From raven web:** turn on **Open videos in raven player** in raven web's Settings, in each browser on a Mac where raven player is installed. The web then offers "Open in raven player" for videos that browser cannot play, and in the player's settings; the browser asks before handing the link over. Progress and history go back to the server as they do from the web. Without a working video engine, raven player opens a server title in your browser instead.
- **raven web on Netlify** hands over the address it was opened at, the Netlify site. Add the server's own address (its Funnel address) to raven player rather than the Netlify site's, so video comes straight from the server and not through Netlify's proxy.

### This computer

Settings, This computer, picks how sound leaves the Mac:

- **Speakers or TV (PCM, up to 7.1)**, the default: everything is decoded and mixed for the output.
- **Receiver passthrough:** the formats your receiver decodes go to it as they are. On macOS that is Dolby Digital (AC3) and DTS core; TrueHD, DTS-HD MA and E-AC3 still play as PCM. The receiver then sets the volume.
- **Headphones**, with spatial audio for AirPods.

The output device is the system's unless you pick one.

### Diagnostics

- **Logs** are in `~/Library/Logs/raven` (Help, Show Logs): `raven.log`, rotated through `raven.log.1` to `raven.log.4` at 1 MB each. They record launches, what kind of thing was opened (`open file .mkv`, `open server title 7 on Vhagar`), refusals, mpv's warnings and errors, and the budget marks (`raven-launch-ms`, `raven-memory-idle-mb`, `raven-quit-ms` and the rest). Every line is redacted before it is written: no cookie values, PINs, passwords, request bodies, file paths or file names. The log does name your servers and their addresses (`open server title 7 on Vhagar`, a server's origin in a trust warning, a server's file URL in an mpv warning), so read it before you attach it to a public issue.
- **Crash reports** stay on the Mac, in `~/Library/Application Support/raven/Crashpad` (Help, Show Crash Reports). Nothing uploads them.
- **Copy Diagnostics** (Help) puts six lines on the clipboard for a bug report: raven player's version and whether it is packaged, the macOS version, the Electron, Chromium and Node versions, the mpv and FFmpeg versions (or why the video engine is unavailable), hardware decoding, and the display's refresh rate and EDR headroom. It holds no paths, file names, server addresses or cookies.

Nothing leaves the Mac unless you send it.

### Updates

Once a day at launch, raven player asks GitHub for the repo's releases and looks for a newer full release (`vX.Y.Z`, not a draft or a prerelease) with its dmg attached. GitHub lists the releases by tag name, so a run of `vX.Y.Z.N` builds can push the app's release off the first page; raven player reads up to five pages of 100. It says this is the newest release only when it found that release in what it read; when GitHub listed none with the app, it says so instead. It sends nothing else, and installs nothing. A newer release shows a quiet notice on Home and Settings, "raven player X.Y.Z is out.", with **See what's new** (the release page) and **Dismiss**. Check for Updates in the raven player menu and **Check now** in Settings, Updates, check at any time; turn off **Check for updates once a day** there to stop the daily check. While raven player is signed ad hoc it cannot update itself: download the new release and install it over the old one.

### Build it

From the repo root, on an Apple Silicon Mac, with the CI-built libmpv and addon in `libs/raven/mpv/resources/darwin-arm64` (see the [library README](../../libs/raven/mpv/README.md); they are built in CI, not on a laptop):

```bash
bunx nx run @raven/desktop:dev            # builds, then runs electron . (unpackaged)
bunx nx run @raven/desktop:make           # the signed-ad-hoc app, its dmg and zip, under apps/raven/desktop/out
bunx nx run @raven/desktop:audit:bundle   # every Mach-O arm64, signed, linked only inside the app
bunx nx run @raven/desktop:smoke:packaged # launches the packaged app, waits for its marks, quits it
bunx nx run @raven/desktop:e2e            # Playwright against electron .
```

`smoke:packaged` runs the packaged app as a person would, with your own `~/Library/Application Support/raven` and `~/Library/Logs/raven`, and refuses to start while another raven player runs. In the PR checks, the `📦 Desktop app` job runs `make`, `audit:bundle` and `smoke:packaged` and uploads the app as `raven-player-darwin-arm64-<sha>`, and `🎬 Desktop end to end` runs `e2e`.

### Release it

1. Cut the release with the `version-bump` skill, with `--push`: one `Release vX.Y.Z` commit and its tag, pushed together. The tag runs `release.yml`, which makes the GitHub release from the commit log, and `desktop-release.yml`, which builds, audits and smoke-tests raven player, waits for that release, attaches the dmg, the zip, the sources and `SHA256SUMS`, and appends the install notes (`apps/raven/desktop/release/install-notes.md`) once. A re-run replaces the assets and leaves the notes. Only a three-number tag (`v0.6.0`, `v0.6.0-rc.1`) runs it; a `vX.Y.Z.N` build tag never does.
2. A pull request that touches the release's files (the workflow, the shared native build action, `forge.config.ts`, `src/build/` or `release/`) runs `desktop-release.yml` as a dry run, which builds the assets as a workflow artifact and never publishes. So does a run from the Actions tab.
3. Dispatching that dry run on `main` before tagging builds what the tag will, at the old version (the tag builds the Release commit, which carries the new one, and checks the tag against it), so a broken release shows before the tag exists. It does not make the tag's build faster. Both workflows restore the libmpv source build (`@raven/mpv:fetch:libmpv`, an Nx cached target) only from Nx Cloud, and the repository has no `NX_CLOUD_ACCESS_TOKEN` secret yet. The `.nx/cache` fallback saves nothing: Nx 23 keeps its local cache in `~/.nx/<workspace id>/cache`, and even moved to `.nx/cache` with `NX_CACHE_DIRECTORY` it is found only through a database named for the machine, so the next runner misses it. So every `🎞️ Desktop native` job and every release build compiles libmpv from source, 11 to 14 minutes on recent runs, well inside the release job's 150 minutes. Once the secret is set, Nx Cloud serves the build to a later run with the same inputs (the source lock, the patches, the build scripts, node-addon-api's version and the Xcode version).

## Layout

```
apps/raven/
  server/        @raven/server: NestJS on Fastify: SQLite index, scanner, ffprobe, thumbnails,
                 range-request file serving, tracks, subtitles and converted streams, and
                 metadata: the TMDB client, matching, the image cache and the item routes
  web/           @raven/web: React 19 + Vite: libraries, the grid, list, tiles and groups, history,
                 movie pages and Fix match, the browser player host, the /design page
  desktop/       @raven/desktop: raven player, the Electron app: main process (grants, servers,
                 the player service over libmpv, logs, updates), preload, renderer, packaging
                 (src/build), e2e
  Dockerfile, docker-compose.yml, docker-compose.vhagar.yml, vhagar-update.sh, .env.example
libs/raven/
  ui/            @raven/ui: shared React player, HTML engine, buttons, icons and styles.
  mpv/           @raven/mpv: the N-API addon over our pinned libmpv build, its macOS video surface
                 and the typed async wrapper; libmpv and the addon are built in CI.
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
| `SCAN_ON_START`               | `true`                         | Quick-scan every library on boot             |
| `QUICK_SCAN_INTERVAL_MINUTES` | `10`                           | Quick-scan the libraries that refresh automatically this often; `0` turns the timer off. Full scans run only on demand |
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
| `RAVEN_MEDIA_ORIGINS`         | unset                          | Where the browser may fetch media from, best first: `kind:url` entries, comma separated, `kind` being `lan`, `tailnet` or `public`. https only, with no path; `http` is for `localhost`. Needs `RAVEN_MEDIA_SECRET` |
| `RAVEN_WEB_ORIGINS`           | unset                          | Web app origins allowed to call the media routes cross-origin. One `*` is allowed, in the first hostname label only, anywhere in it, standing for one or more characters other than a dot (`https://deploy-preview-*--raven-player.netlify.app`); `http` is for `localhost` |
| `RAVEN_MEDIA_SECRET`          | unset                          | Signs media tickets: 32 random bytes or more, base64. Rotating it ends every ticket |

## Not there yet

- No accounts. Everyone who reaches raven, on the LAN or through [Funnel](#public-through-tailscale-funnel), shares one set of progress, history and favourites; the [admin lock](#admin-lock) and the PIN are what keep the rest to you.
- Picture subtitles (PGS, VobSub) would need burning in or OCR.
- On VAAPI, HDR is converted to BT.709 on the GPU rather than tone mapped. That suits HLG; HDR10 (PQ) comes out flat.
- No QSV; Intel GPUs go through VAAPI.
- raven player plays only: it has no library mode, local or remote, so browsing, scanning and matching stay with the server and the web.
- raven player runs only on Apple Silicon Macs: no Intel Macs, Windows or Linux yet.
- raven player is signed ad hoc, not with a Developer ID or notarized, so it needs Open Anyway once and cannot update itself.
