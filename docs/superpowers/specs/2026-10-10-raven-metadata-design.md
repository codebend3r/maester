# raven's metadata: posters, cast, ratings and reviews for movies and TV

Date: 2026-10-10. Status: decided autonomously from the request and a study
of how Plex does it; open to review in the PR. Builds on the player work in
#96, which records each library's type (`kind`) and says later work would
use it. This is that work.

## Goal

A Movies or TV shows library knows what each of its videos is, and shows it
the way Plex does:

1. Library pages show posters, titles and years, one card per movie or show.
2. Every movie, show, season and episode has a page: backdrop, poster,
   title, who made it, content rating, year, runtime, genres, ratings,
   summary, the file's video, audio and subtitles, and a cast and crew row
   with photos.
3. Ratings come from TMDB, IMDb, Rotten Tomatoes and Metacritic, with
   reviews beneath them.
4. A wrong match is fixed from the page, and stays fixed.

Success: on Vhagar, a Radarr-named Movies library and a Sonarr-named TV
library match without help for at least 95% of their files, with no wrong
match in a sample of 100. Library pages load as fast as they do today. With
no keys and no internet, raven still works as it does today, with tidier
titles.

## What the request said, and what was assumed

| Said | Assumed |
| --- | --- |
| Metadata for movies and TV shows | Only libraries whose type is Movies or TV shows. Other libraries stay exactly as they are |
| Like Plex: posters, title | TMDB is the one source for titles, summaries, images, cast and crew, content ratings and its own score. TVDB is left out: TMDB covers TV, and one source means one matcher |
| Cast and crew | TMDB's credits, with photos: billed cast, then directors, writers, creators and producers. A person's page lists what else of theirs raven holds |
| Ratings | TMDB's score always. IMDb, Rotten Tomatoes (critics) and Metacritic through OMDb when `OMDB_API_KEY` is set. Rotten Tomatoes' audience score has no free source and is left out |
| Critic reviews | Rotten Tomatoes reviews have no public API, and the reviews in Plex's screenshot are written by Plex's own members. raven shows reviews by TMDB members and says so. raven's own Rate & Review waits until raven signs viewers in through rookery |
| Do not ask questions | Every choice here is a default taken from Plex's behaviour and raven's code. The PR is where they get reviewed |

## How Plex does it

From Plex's developer docs, support pages and forums, and the last 30 days of
r/PleX, Hacker News and GitHub:

- **Match, then fetch.** Plex turns a file's name, folder, year and any ids
  into one canonical id, then hangs everything else off it. Folder names can
  carry ids: `{tmdb-603}`, `{imdb-tt0133093}`, `{tvdb-81189}`.
- **Providers.** Since Plex Media Server 1.43, metadata comes from metadata
  providers: HTTP services that return one schema, stacked in an order the
  owner picks (local files, then TMDB, then Plex's own for cast). The old
  Python agents are removed in 2026.
- **One schema.** `title`, `originalTitle`, `titleSort`, `year`,
  `originallyAvailableAt`, `summary`, `tagline`, `contentRating` (with a
  country prefix outside the US, `gb/15`), `duration` and `studio`, plus
  arrays: `Image` (`coverPoster`, `background`, `clearLogo`, `snapshot`),
  `Genre`, `Guid` (imdb, tmdb, tvdb), `Role`, `Director`, `Writer` and
  `Producer` (`tag`, `role`, `thumb`, `order`), and `Rating` (`image`, `type`
  of `critic` or `audience`, `value` from 0 to 10). TV is a show, its
  seasons (`index`) and their episodes (`parentIndex`, `index`); an
  episode's image is a `snapshot`.
- **Images.** URLs from the provider, which Plex downloads and keeps. Files
  beside the media (`poster.jpg`, `fanart.jpg`, `Season01.jpg`) win when
  Local Media Assets comes first.
- **Ratings.** Each library picks a Ratings Source (Rotten Tomatoes, IMDb or
  TMDB). The rating's badge string picks the icon
  (`rottentomatoes://image.rating.ripe`, `imdb://image.rating`). When Rotten
  Tomatoes has no score, Plex falls back to TMDB or IMDb. A change applies on
  the next refresh.
- **Reviews.** The Ratings & Reviews cards are reviews by Plex members,
  launched in October 2024, shared with friends at first and public since
  January 2025. They are not critics' reviews.
- **Fixing.** Fix Match searches and re-points an item, Refresh Metadata
  fetches it again, and fields edited by hand are locked against refreshes.
- **What people say.** Plex's default posters are its weak spot, so people
  fix them by hand: r/PlexPosters, ThePosterDB and Kometa all exist to
  replace them.

Sources: the [custom metadata providers announcement](https://forums.plex.tv/t/announcement-custom-metadata-providers/934384),
Plex's [example TMDB provider](https://github.com/plexinc/tmdb-example-provider)
and its `docs/Metadata.md`, [Plex Movie agent settings](https://support.plex.tv/articles/advanced-settings-plex-movie-agent/),
[local media assets](https://support.plex.tv/articles/200220717-local-media-assets-tv-shows/),
and [TechCrunch on Plex reviews](https://techcrunch.com/2024/10/09/streamer-plex-rolls-out-movie-and-tv-show-reviews/).

## Where metadata comes from

### TMDB

- API v3 at `https://api.themoviedb.org/3`, authenticated by the API Read
  Access Token sent as a bearer token, set as `TMDB_API_TOKEN`. Free for
  non-commercial use with attribution.
- Every call passes `language` from `METADATA_LANGUAGE`.

| Call | For |
| --- | --- |
| `GET /search/movie?query&year` | Matching a movie |
| `GET /search/tv?query&first_air_date_year` | Matching a show |
| `GET /find/{id}?external_source=imdb_id` (or `tvdb_id`) | An IMDb or TVDB id from a name or NFO |
| `GET /movie/{id}?append_to_response=credits,release_dates,external_ids,reviews` | A movie, its cast and crew, content ratings and reviews |
| `GET /tv/{id}?append_to_response=aggregate_credits,content_ratings,external_ids,reviews` | A show and its cast over the whole run |
| `GET /tv/{id}/season/{n}?append_to_response=credits` | A season and its episodes, each with its still, crew and guest stars |

- Images come from `https://image.tmdb.org/t/p/{size}{path}` at one size per
  kind: posters `w500`, backdrops `w1280`, photos `w185`, stills `w300`.
- TMDB's rate ceiling sits around 40 requests a second. raven keeps to 20 a
  second with at most 4 in flight, and backs off on a 429.
- Attribution: TMDB's logo and "This product uses the TMDB API but is not
  endorsed or certified by TMDB." at the foot of every page that shows its
  data. Read TMDB's current API terms (attribution, caching, non-commercial
  use) before phase 1 ships.

### OMDb (phase 3, optional)

- `GET https://www.omdbapi.com/?i={imdbId}&apikey={OMDB_API_KEY}` returns
  `Ratings`, with `Internet Movie Database` ("7.5/10"), `Rotten Tomatoes`
  ("85%") and `Metacritic` ("74/100") where they exist.
- A free key allows 1,000 calls a day. raven counts its calls and stops at
  `OMDB_DAILY_LIMIT` until midnight UTC, so a big library fills over a few
  days.
- Movies and shows only; episodes are skipped.

### Files beside the media

Ids, which beat a search:

- In folder and file names: Plex's `{tmdb-603}`, `{imdb-tt0133093}` and
  `{tvdb-81189}`, and the `[tmdbid-603]`, `[imdbid-tt0133093]` and
  `[tvdbid-81189]` that Jellyfin and Radarr write.
- In a `movie.nfo`, `<file stem>.nfo` or `tvshow.nfo` that Radarr or Sonarr
  wrote: `<uniqueid type="...">`, `<tmdbid>`, `<imdbid>` and `<tvdbid>`. Only
  ids are read from an NFO, never the rest of it.

Images, which beat TMDB's:

| Image | Names (`jpg`, `jpeg`, `png` or `webp`) |
| --- | --- |
| Movie poster | `poster`, `folder`, `cover` or `<file stem>-poster` in the movie's folder |
| Movie backdrop | `fanart`, `backdrop`, `background` or `<file stem>-fanart` |
| Show poster | `poster`, `folder` or `show` in the show's folder |
| Show backdrop | `fanart`, `backdrop` or `background` in the show's folder |
| Season poster | `Season01` or `season01-poster` in the show's or season's folder; `season-specials-poster` for season 0 |
| Episode still | `<file stem>-thumb` |

- A movie's folder images count only when that folder holds one movie, so a
  `folder.jpg` at a library's root is not every movie's poster.
- Each folder is read once per pass, through the scan's filesystem gate.
- Local images are scaled once with ffmpeg to TMDB's widths and cached. The
  originals are never changed.

## Reading names

Names are parsed in `libs/raven/core/src/naming.ts`: pure functions with no
Node APIs, beside `titleFromFileName`.

### Movies

The movie's own folder is read first when its name has a year, which is how
Radarr names folders; otherwise the file name is read.

1. Ids come out: `{tmdb-...}`, `{imdb-...}`, `{tvdb-...}`, `[tmdbid-...]`
   and the rest.
2. The edition comes out: Plex's `{edition-Director's Cut}`.
3. The year is the last `(YYYY)`. Failing that, it's the last `19xx` or
   `20xx` token that is followed by release tags or the end of the name.
4. Everything after the year goes. Without a year, everything from the
   first release tag goes. Release tags are `2160p`, `1080p`, `720p`,
   `480p`, `BluRay`, `Bluray`, `REMUX`, `WEB-DL`, `WEBDL`, `WEBRip`, `HDTV`,
   `DVDRip`, `x264`, `x265`, `H.264`, `HEVC`, `HDR`, `DV`, `PROPER`,
   `REPACK`, and a bracketed release group.
5. Dots and underscores become spaces, as `titleFromFileName` does today.

| Name | Title | Year | Other |
| --- | --- | --- | --- |
| `The Matrix (1999)/The Matrix (1999) Bluray-1080p.mkv` | The Matrix | 1999 | |
| `The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv` | The Matrix | 1999 | |
| `1917 (2019)/1917 (2019) WEBDL-2160p.mkv` | 1917 | 2019 | |
| `Blade Runner 2049 (2017) {imdb-tt1856101}/...` | Blade Runner 2049 | 2017 | IMDb id |
| `2001.A.Space.Odyssey.1968.2160p.UHD.mkv` | 2001 A Space Odyssey | 1968 | |
| `Aliens (1986) {edition-Special Edition}.mkv` | Aliens | 1986 | Edition |

### Episodes

- **Show.** The first segment of the file's `folder` is the show's folder.
  When that segment is a season folder, or the file sits at the library's
  root, the show is read from the file name up to the episode code; failing
  that, from the library folder's own name.
- **Season and episode.** `S01E02`, `S1E2`, `S01E123` (three-digit episodes,
  as anime is named here), `S01E01-E02`, `S01E01E02` and `1x02`. A season
  folder (`Season 1`, `Season 01`, or `Specials` for 0) supplies the season
  when the name has none.
- **Read but not used yet.** Absolute numbers in anime names (`(0123)`) and
  air dates (`2026.10.09`). An absolute number before the episode code is
  never read as a year, even when it looks like one (`(2001)`).

| Name | Show | Season | Episodes |
| --- | --- | --- | --- |
| `Severance (2022)/Season 01/Severance - S01E02 - Half Loop WEBDL-2160p.mkv` | Severance, 2022 | 1 | 2 |
| `Frieren/Season 01/Frieren - (0012) S01E012 - A Real Hero Bluray-1080p.mkv` | Frieren | 1 | 12 |
| `The Office (US)/Specials/The Office (US) - S00E03.mkv` | The Office (US) | 0 | 3 |
| `Fargo/Fargo.S02E09E10.1080p.mkv` | Fargo | 2 | 9 and 10 |

### Extras

Some files are never matched; they stay listed as they are today:

- Files in Plex's extras folders: `Behind The Scenes`, `Deleted Scenes`,
  `Featurettes`, `Interviews`, `Scenes`, `Shorts`, `Trailers`, `Extras` and
  `Other`.
- Files with Plex's extras suffixes: `-trailer`, `-featurette`,
  `-behindthescenes`, `-deleted`, `-interview`, `-scene`, `-short` and
  `-other`.

## Matching

- **When.** A file is matched when it is first indexed, when its library's
  type becomes Movies or TV shows, when a TMDB token is first configured,
  and when the viewer asks. Matching needs only the path, so it never waits
  on ffprobe. A changed file (same path, new size or mtime) keeps its match.
- **Order.** A Fix match override wins, then an id from a name or NFO, then a
  search by title and year.
- **Accepting a search result.** Titles are compared after folding case,
  accents and punctuation, `&` to "and", and a leading "The", "A" or "An".
  Each result's `title` and `original_title` are both tried.
  - Accept when the folded titles are equal and the year matches, or is one
    year either side (release dates differ by country).
  - Accept when the search returns exactly one result and its year matches.
  - Otherwise the file is `unmatched`. raven never guesses.
- **TV.** A show is matched once per show folder per pass, and each season is
  fetched once. An episode links to the season's episode with its number,
  and a two-episode file links to both. An episode TMDB doesn't list (a
  different episode order, or absolute numbering) links to nothing, but
  still appears under its show and season with its parsed name.
- **Fix match.** The viewer searches TMDB from the page and picks a result.
  The choice is saved as an override on the movie's folder or the show's
  folder (or on the file, at a library's root). A rename or a re-download
  keeps it. The file's `match` becomes `manual`, and nothing automatic
  replaces it. Picking "Not a movie" (or "Not a show") saves an override
  that leaves it unmatched.
- **Renames.** The scan sees a rename as a delete and an insert, which gives
  the file a new `media.id`. The new row matches to the item already stored,
  costing one search and no fetch.
- **Keeping fresh.** A sweep runs on start and every 24 hours. It refreshes
  items fetched more than 30 days ago, or more than 7 days ago when they
  were released in the last 90 days or the show is still airing.
- **Clearing up.** At the end of each pass, items with no file under them,
  people with no credits, and their cached images are removed.

## Storage

Migration 8 (phase 1). Each statement keeps the existing style: append only,
with a comment saying why.

```sql
-- What a file is: a movie, show, season or episode as TMDB describes it,
-- shared by every file and library that holds it.
CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,                  -- 'movie', 'show', 'season', 'episode'
  tmdb_id TEXT NOT NULL,
  parent_id INTEGER REFERENCES items (id) ON DELETE CASCADE,
  number INTEGER,                      -- a season's or episode's number
  title TEXT NOT NULL,
  original_title TEXT,
  sort_title TEXT NOT NULL,            -- no leading "The", "A" or "An"
  year INTEGER,
  released TEXT,                       -- YYYY-MM-DD: release, first air or air date
  ended TEXT,                          -- a show's last air date, once it has ended
  summary TEXT,
  tagline TEXT,
  content_rating TEXT,                 -- for METADATA_COUNTRY, then US
  runtime INTEGER,                     -- minutes
  studio TEXT,                         -- a movie's studio or a show's network
  genres TEXT NOT NULL DEFAULT '[]',   -- JSON array of names
  imdb_id TEXT,
  tvdb_id TEXT,
  fetched_at TEXT NOT NULL,
  UNIQUE (type, tmdb_id)
);
CREATE INDEX items_parent ON items (parent_id, number);

-- Which item a file is. A movie kept in two qualities is two rows; a file
-- holding two episodes is two rows too.
CREATE TABLE media_items (
  media_id INTEGER NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  PRIMARY KEY (media_id, item_id)
);
CREATE INDEX media_items_item ON media_items (item_id);

-- A match the viewer chose, kept by folder so renames and re-downloads
-- keep it. A NULL tmdb_id means "leave it unmatched".
CREATE TABLE match_overrides (
  library_id INTEGER NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
  place TEXT NOT NULL,                 -- a folder, or a file at the root
  tmdb_id TEXT,
  PRIMARY KEY (library_id, place)
);

-- Where an item's pictures come from: a TMDB path, or a file beside the
-- media, which wins.
CREATE TABLE item_images (
  item_id INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                  -- 'poster', 'backdrop', 'still'
  source TEXT NOT NULL,                -- 'tmdb', 'local'
  ref TEXT NOT NULL,                   -- TMDB path, or an absolute file path
  PRIMARY KEY (item_id, kind, source)
);

CREATE TABLE people (
  id INTEGER PRIMARY KEY,
  tmdb_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  photo TEXT                           -- TMDB path
);

CREATE TABLE credits (
  item_id INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  job TEXT NOT NULL,                   -- 'cast', 'guest', 'director', 'writer', 'creator', 'producer'
  role TEXT,                           -- the character, or "Screenplay / Story"
  position INTEGER NOT NULL,
  PRIMARY KEY (item_id, person_id, job)
);
CREATE INDEX credits_person ON credits (person_id);

-- Scores out of 10, one per source.
CREATE TABLE ratings (
  item_id INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  source TEXT NOT NULL,                -- 'tmdb', 'imdb', 'rottenTomatoes', 'metacritic'
  value REAL NOT NULL,
  votes INTEGER,
  PRIMARY KEY (item_id, source)
);

-- What the name says, and how far matching got. Other libraries are off.
ALTER TABLE media ADD COLUMN year INTEGER;
ALTER TABLE media ADD COLUMN edition TEXT;
ALTER TABLE media ADD COLUMN match TEXT NOT NULL DEFAULT 'pending';
UPDATE media SET match = 'off'
  WHERE library_id IN (SELECT id FROM libraries WHERE kind = 'other');
CREATE INDEX media_match_pending ON media (match) WHERE match = 'pending';
```

- `match` is `pending`, `matched`, `manual`, `unmatched` or `off`.
- In Movies and TV libraries, `media.title` becomes the parsed title, and
  `media.year` the parsed year. Other libraries keep today's tidied file
  name, and a library that becomes Other goes back to it.
- Credits keep the first 50 billed cast, every director, writer and
  creator, and the first 10 producers. A person with two jobs of one kind
  has one row, with the roles joined ("Screenplay / Story").
- Phase 2 needs no migration.

Migration 9 (phase 3):

```sql
-- Reviews by TMDB members, newest first in the UI.
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  tmdb_id TEXT NOT NULL UNIQUE,
  author TEXT NOT NULL,
  avatar TEXT,                         -- TMDB path only; anything else is dropped
  rating REAL,                         -- out of 10, when the author gave one
  content TEXT NOT NULL,
  url TEXT NOT NULL,
  written_at TEXT NOT NULL
);
CREATE INDEX reviews_item ON reviews (item_id, written_at);

-- Which score a library's cards show and sort by, and when OMDb last answered.
ALTER TABLE libraries ADD COLUMN ratings_source TEXT NOT NULL DEFAULT 'tmdb';
ALTER TABLE items ADD COLUMN omdb_fetched_at TEXT;
```

Image files sit beside the thumbnails:

- `<data>/images/tmdb/<size>/<file>`, shared by every item and person that
  uses the same TMDB file.
- `<data>/images/local/<item id>-<kind>-<mtime>.jpg`.
- Posters are fetched as soon as an item is matched, so the first visit to a
  library is fast. At about 60 KB each, 3,000 movies come to about 180 MB.
- Backdrops, photos and stills are fetched the first time they're shown.

## The server

New types in `libs/raven/core/src/types.ts`, each with a guard:

```ts
export type MatchState = 'pending' | 'matched' | 'manual' | 'unmatched' | 'off'

export type ItemType = 'movie' | 'show' | 'season' | 'episode'

export type ItemSummary = {
  id: number
  type: ItemType
  title: string
  year: number | null
  /** For seasons and episodes: the show they belong to. */
  show: { id: number; title: string } | null
  season: number | null
  episode: number | null
  /** Changes whenever the poster does; null when there is none. */
  posterVersion: string | null
}

export type RatingSource = 'tmdb' | 'imdb' | 'rottenTomatoes' | 'metacritic'

export type Rating = {
  source: RatingSource
  /** Rotten Tomatoes and Metacritic are critics; TMDB and IMDb are audiences. */
  kind: 'critic' | 'audience'
  /** Out of 10. */
  value: number
  votes: number | null
}

export type CreditJob = 'cast' | 'guest' | 'director' | 'writer' | 'creator' | 'producer'

export type Credit = {
  personId: number
  name: string
  job: CreditJob
  /** The character, or the job in full: "Screenplay", "Novel". */
  role: string | null
  photoVersion: string | null
}

export type ItemDetails = ItemSummary & {
  tmdbId: string
  imdbId: string | null
  originalTitle: string | null
  tagline: string | null
  summary: string | null
  contentRating: string | null
  released: string | null
  ended: string | null
  /** Minutes, from TMDB; pages prefer the file's own length. */
  runtime: number | null
  studio: string | null
  genres: string[]
  backdropVersion: string | null
  ratings: Rating[]
  credits: Credit[]
  /** Every file that is this item, in any library, best first. */
  versions: MediaItem[]
  /** A show's seasons, or a season's episodes, in order. */
  children: ItemSummary[]
}
```

`MediaItem` gains:

- `match: MatchState`
- `year: number | null`
- `edition: string | null`
- `item: ItemSummary | null`
- `versions: number`: how many files in its library are the same movie,
  this one included; 1 for anything else.

Each new field also goes into the guard, the core and web fixtures, and the
`/design` samples.

| Route | Phase | What |
| --- | --- | --- |
| `GET /api/items/:id` | 1 | `ItemDetails` |
| `GET /api/items/:id/images/:kind?v=` | 1 | The poster, backdrop or still, fetched and cached on first use; `immutable` with `v`, as thumbnails are |
| `GET /api/people/:id/photo?v=` | 1 | A person's photo, the same way |
| `GET /api/match/search?type&query&year` | 1 | TMDB's results as `MatchCandidate[]` (id, title, year, overview, poster) for Fix match. Candidate posters come through the image route too |
| `PUT /api/media/:id/match` | 1 | `{ tmdbId }`, or `{ tmdbId: null }` for "not a movie"; saves the override and returns the `MediaItem` |
| `POST /api/items/:id/refresh` | 1 | Fetches the item again now |
| `PUT /api/items/:id/match` | 2 | Re-points every file under a show to another show, keeping their season and episode numbers |
| `GET /api/libraries/:id/shows?q&sort&seed` | 2 | `ShowEntry[]`: the show's `ItemSummary`, its episode count, the newest episode's `addedAt`, and the next episode to watch |
| `GET /api/people/:id` | 3 | `PersonDetails`: name, photo, and the items in raven they're credited on |
| `GET /api/reviews/:id/avatar?v=` | 3 | A reviewer's TMDB avatar |

Changed routes:

- `GET /api/libraries/:id/media` returns one entry per movie in a Movies
  library: its best version (highest resolution, then the largest file),
  with `versions` set. Search matches item titles and original titles as
  well as file titles.
- `PUT /api/libraries/:id` re-matches the library's files when `kind`
  changes.
- `GET /api/health` gains `metadata: { tmdb, omdb, pending }`, where `tmdb`
  and `omdb` are `'off' | 'ok' | 'failing'` and `pending` counts the files
  waiting to be matched.

Sorts:

- New: `year-new` and `year-old` (phase 1), `rating-high` and `rating-low`
  (phase 3, by the library's ratings source, falling back to TMDB's score).
- Title sorts use the matched item's `sort_title`.
- The file sorts (largest, smallest, bitrate, resolution) use each movie's
  best version, and are not offered for TV shows.
- Files with no year or rating sort last.

Images are fetched only from `image.tmdb.org`, and only for paths matching
`^/[A-Za-z0-9_-]+\.(jpg|png)$`. The browser never talks to TMDB or OMDb, and
the token and key never reach it, the logs or `/api/health`.

## The pages

All of it uses the tokens in `globals.scss`, lays out with grid and `gap`,
and works at 320px wide. Red stays for "where you stopped" and the one
primary action.

### Library pages

Movies (phase 1):

- **Grid and grouped.** A new `PosterCard`: a 2:3 poster, with the title
  and year beneath and "2 versions" when there's more than one. It has the
  resume bar and heart of `MediaCard`, and posters get a narrower track,
  `minmax(min(10rem, 100%), 1fr)`.
- **No poster yet.** The card falls back to the frame grab cropped to 2:3,
  then to the letter placeholder. An unmatched file says "Not matched"
  under its title.
- **Tiles.** The 16:9 thumbnail becomes a small poster.
- **List.** Gains a Year column.
- **Opening a card.** A matched card opens the movie's page, and its play
  button plays at once. Unmatched and pending files keep opening the player.
- **Card menu.** `MediaMenu` gains Fix match and Refresh details.

TV shows (phase 2):

- Cards are shows: poster, title, years, and how many episodes there are.
- Sorts are title, recently added, oldest added, year and random, with
  rating added in phase 3. The grouped view isn't offered.
- Episodes with no matched show sit in a last section, "Not matched", as
  today's cards.

Elsewhere:

- History, Favourites and the player's title use the matched names:
  "The Matrix (1999)", and for episodes "Severance · S01E02 · Half Loop".
- The library dialog's Type field explains itself. When TMDB is on: "Movies
  and TV shows get posters and details from TMDB." When it's off: "Set
  `TMDB_API_TOKEN` in raven's `.env` for posters and details."

### Movie page, `/movies/:id`

Top to bottom (on narrow screens the poster sits above the details):

- **Backdrop.** Behind the top of the page, fading into `--color-night`.
  It's decorative (`alt=""`), and there's no parallax.
- **Poster.**
- **Title.** In Young Serif at `--font-size-hero`, with "Directed by ..."
  beneath in lichen.
- **Facts.** The content rating in a bordered badge, then the year, the
  runtime and up to three genres. The runtime is the file's own length when
  probed, and TMDB's otherwise.
- **Rating chips.** TMDB's in phase 1; Rotten Tomatoes, IMDb and Metacritic
  join in phase 3.
- **Actions.** Play is the one red button, reading "Resume from 42:10" when
  there's a saved spot. Then favourite, and a menu with Fix match, Refresh
  details and Delete file.
- **Summary.** The tagline, then the summary, clamped to three lines with
  More.
- **File.** Video ("1080p (H.264)"), audio ("English (EAC3 5.1)") and
  subtitles ("English, Spanish"), from the tracks the scan stored.
- **Versions.** Only when there's more than one: a row each with
  resolution, codec, size, edition and library, each playable.
- **Cast & Crew.** A `<ul>` of round photos, with name and role beneath:
  - Laid out with `grid-auto-flow: column` and scroll snap, with previous
    and next buttons that scroll by a page.
  - Billed cast first, then directors, writers and producers.
  - Someone who both acts and directs appears once, with their roles
    joined: "Mark Kimball / Director".
  - From phase 3, each person links to their page.
- **Ratings & Reviews.** Phase 3.
- **Attribution.** TMDB's, at the foot of the page.

### Show, season and episode pages (phase 2)

- **`/shows/:id`.** A header like the movie page's, plus:
  - "Created by", the years ("2011 to 2019", or "2022 to now"), and the
    network.
  - "Play S02E03": the first episode not yet watched, by the library's
    watched percentage.
  - A row of season posters with their episode counts.
  - Cast & Crew from the whole run.
- **`/shows/:id/seasons/:number`.** The season's poster and summary, then
  its episodes in order, listing only episodes on disk. Each shows:
  - its still (TMDB's, else the frame grab);
  - its number, title, air date and runtime;
  - a two-line summary;
  - a watched mark or resume bar, and a play button.
- **`/episodes/:id`.** The still as the backdrop, then "Severance ·
  Season 1 · Episode 2", the title, the air date and the summary. Below
  those: guest stars and crew, the file and its versions, and Play.

### Ratings and reviews (phase 3)

- **Rating chips.** Each has a small mark, a value, and an accessible label
  such as "Rotten Tomatoes critics, 41%, rotten":
  - Rotten Tomatoes: a tomato at 60% or more, a splat below.
  - IMDb: the score out of 10.
  - Metacritic: the score out of 100, on a green, yellow or red square.
  - TMDB: a percentage.

  The marks are their own small `RatingMark` component, since `Icon` draws
  one-stroke glyphs.
- **Ratings shown.** A new library setting (`ratingsSource`): TMDB (the
  default), IMDb or Rotten Tomatoes. It picks the score shown on cards and
  used by the rating sorts. Like Plex, a movie without that score falls back
  to TMDB's.
- **Reviews.** Headed "Reviews from TMDB members": up to ten, newest first,
  as cards. Each card has:
  - the avatar, if TMDB hosts it, and initials otherwise;
  - the author and a relative date ("6 h ago");
  - the author's score as stars out of five, halves allowed;
  - four lines of text, and Read, which opens a dialog with the whole
    review and a link to it on TMDB.

  Review text is shown as plain paragraphs, never as HTML.
- **`/people/:id`.** Photo, name, and everything in raven the person is
  credited on, as poster cards grouped by job (Acting, Directing, Writing),
  newest first.

### Fix match

A dialog with:

- A search box filled with the parsed title, and a year field.
- Results showing poster, title, year and two lines of overview, each with
  Choose.
- "Not a movie" (or "Not a show") at the foot.

For a show, Fix match lives on the show's page and moves every episode
under it.

### `/design`

New specimens for `PosterCard`, `ItemHeader`, `RatingChips`, `CastRow` and
`ReviewCard`, with sample data in `samples.ts`.

## Configuration

| Env var | Default | What |
| --- | --- | --- |
| `TMDB_API_TOKEN` | unset | TMDB's API Read Access Token. Unset turns metadata off |
| `OMDB_API_KEY` | unset | Phase 3: IMDb, Rotten Tomatoes and Metacritic scores |
| `OMDB_DAILY_LIMIT` | `1000` | OMDb calls a day |
| `METADATA_LANGUAGE` | `en-US` | Language for titles and summaries |
| `METADATA_COUNTRY` | `US` | Whose content rating and release date to show |

- raven gets its first secrets. `apps/raven/.env.example` lists them, and
  both compose files gain `env_file: .env`, as luwin's does.
  `Dockerfile.dockerignore` already keeps `.env` out of the image.
- These are raven's first outbound calls. The container must reach
  `api.themoviedb.org`, `image.tmdb.org` and, with a key, `www.omdbapi.com`.
  Check that from the container on Vhagar before phase 1 ships, and say so
  in the README.

## Code layout

| Where | What |
| --- | --- |
| `libs/raven/core/src/naming.ts` | `parseMovieName`, `parseEpisodeName`, `isExtra`, `foldTitle` |
| `libs/raven/core/src/types.ts`, `guards.ts` | The types above and their guards; the new `MediaItem` fields, `LibrarySettings.ratingsSource` and sorts |
| `libs/raven/core/src/apiClient.ts` | `getItem`, `searchMatches`, `setMatch`, `refreshItem`, `listShows`, `getPerson`, `itemImageUrl`, `photoUrl` |
| `apps/raven/server/src/db/database.ts` | Migrations 8 and 9 |
| `apps/raven/server/src/metadata/` | `tmdbClient`, `omdbClient`, `matcher`, `localAssets`, `nfo`, `imageCache`, `metadataRepository`, `metadataService` (queue, sweep, clear-up) |
| `apps/raven/server/src/items/` | `itemsController`, `matchController`, `peopleController`, `imagesController` |
| `apps/raven/server/src/scanner/` | New and re-pathed files go on the metadata queue; `createRateLimit` beside `createGate` in `concurrency.ts` |
| `apps/raven/server/src/media/mediaRepository.ts` | The item join, one entry per movie, the new sorts, search over item titles |
| `apps/raven/server/src/libraries/librariesController.ts` | Re-match on a `kind` change |
| `apps/raven/server/src/config.ts` | The env vars above. The clients take an injected `fetch` (a `METADATA_FETCH` token), so tests never touch the network |
| `apps/raven/web/src/pages/` | `MoviePage`, `ShowPage`, `SeasonPage`, `EpisodePage`, `PersonPage`, and their routes in `AppRoutes.tsx` |
| `apps/raven/web/src/components/` | `PosterCard`, `ItemHeader`, `RatingChips`, `RatingMark`, `CastRow`, `Versions`, `ReviewCards`, `FixMatchDialog`, `TmdbCredit` |
| `apps/raven/.env.example`, compose files, `README.md` | The keys, `env_file`, and a Metadata section |

## Errors

- **No `TMDB_API_TOKEN`.** Metadata is off and health says `off`. Movies and
  TV libraries look as they do today, with parsed titles and years.
- **TMDB unreachable, failing or slow** (10 seconds per call). The file
  stays `pending`, and the next pass tries again (on start, after a scan, or
  in the daily sweep). Health says `failing`, with when it last worked.
  Scans and playback never wait on it.
- **401.** The token is wrong. Matching stops until a restart, and health
  says why; nothing retries in a loop.
- **429.** raven waits out `Retry-After` and halves its rate for the rest of
  the pass.
- **A stored id that TMDB no longer has.** The item goes. Its files return
  to `pending`, or to `unmatched` when an override pointed there.
- **An image TMDB can't serve.** The route returns 404, and the page falls
  back to the frame grab or the letter.
- **OMDb's daily budget spent.** No more calls until midnight UTC. Stored
  scores stay.
- **An unsure match.** The file is `unmatched`, never a guess.
- **An NFO that isn't XML, or a local image that won't decode.** Ignored,
  and logged once.

## Testing

- **Core (vitest).**
  - Naming, against a table of real names: the Radarr and Sonarr formats
    used on the NAS, including anime's `Show - (0123) S01E123 - Title`; also
    scene names, titles that are years, editions, id tags and extras.
  - `foldTitle`, the guard for every new type, and the client calls.
- **Server (vitest).**
  - `TmdbClient` and `OmdbClient` against recorded JSON through the injected
    `fetch`: success, 401, 404, a 429 with `Retry-After`, and timeouts.
  - The matcher's accept and refuse cases.
  - Finding NFOs and local images in a temp folder.
  - Migration 8 on a version 7 database holding media in Movies and Other
    libraries.
  - End to end, with `app.inject` and a fake TMDB: scan a temp library of
    named files, settle, then check:
    - the items, credits and one-card-per-movie listing;
    - that the image route serves cached bytes;
    - that Fix match survives a rename;
    - that a `kind` change re-matches;
    - that clear-up runs once the files are gone.
- **Web (bun test, happy-dom).**
  - `PosterCard`'s fallbacks.
  - The movie page's sections, and their absence when data is missing.
  - Scrolling the cast row by keyboard.
  - The Fix match flow.
  - The show and season pages.
  - The rating chips' labels.
  - The review dialog showing text, not HTML.
- **By hand, on Vhagar.**
  - The real Movies and TV libraries: the match rate, and a sample of 100
    matches checked by eye.
  - A library's first load with and without cached posters.
  - raven with no token, and with the container cut off from the internet.

## Order of work

One PR per phase. Each leaves raven working and shippable on its own.

1. **Movies.** Naming, the TMDB client, matching, local ids and images, the
   image cache, migration 8, poster cards, the movie page, Fix match and
   Refresh details, TMDB's score, and cast and crew.
2. **TV shows.** Episode naming, show matching, the show listing, and the
   show, season and episode pages.
3. **Ratings and reviews.** OMDb, the Ratings shown setting and rating
   sorts, reviews, person pages, and migration 9.

## Out of scope

- Editing fields by hand and locking them, and picking another poster from
  TMDB's alternatives.
- Extras and trailers (TMDB's videos, and the files this spec leaves
  unmatched).
- Collections (TMDB's `belongs_to_collection`).
- Missing episodes and seasons.
- Matching by absolute number or air date, and other episode orders (TMDB's
  episode groups).
- Theme music, clear logos and chapter images.
- raven's own Rate & Review, which needs raven to sign viewers in through
  rookery.
- Rotten Tomatoes' audience score and Letterboxd (MDBList, a paid key).
- TVDB as a second source.
- One card for a movie kept in two libraries.
- Filtering by genre, person or decade.
- Hiding the stills of unwatched episodes.
- luwin answering questions about what raven holds.
