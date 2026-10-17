# raven: people, back buttons, show ratings and library Refresh

Date: 2026-10-17. Status: approved, building as a stack of PRs.

## Why

A person's page (`/people/:id`) lists only the titles raven holds, as poster cards, and nothing about the person. It also drops credits on episodes: Isabel May's ten Young Sheldon episodes never show, as `MetadataRepository.person()` keeps only movies and shows. raven never asks TMDB about a person.

Around it:

- No page goes back to where the viewer came from. Every Back is a link to a fixed parent, and several pages have none.
- TV shows have no Rotten Tomatoes or Metacritic score. OMDb, raven's only source for them, has none for series (see Spike).
- A library's ratings refresh only on their own clock (first match, then every 30 days). An admin can't ask for new files and fresh ratings at once.
- A library card lists its folders as chips that wrap unevenly, so a library over seven folders reads as a jumble.

## Decisions

Taken with the user on 2026-10-17:

1. **Ratings for shows.** MDBList becomes a source behind `MDBLIST_API_KEY`, and OMDb stays as the fallback.
2. **Refresh.** One admin Refresh per library quick-scans its folders, then re-fetches every title's IMDb, Rotten Tomatoes, Metacritic and TMDB ratings. Rescan stays beside it.
3. **Folders.** A card's folders are grouped by parent directory, one line per parent.
4. **Appearances.** Appearances as themselves (talk shows, news, award shows and the like) are hidden from a filmography by default, behind a toggle.

## Spike (2026-10-17)

- **OMDb.** For series, `Ratings` holds only "Internet Movie Database" and `Metascore` is `N/A`. This held for Abbott Elementary (`tt14218830`), MobLand (`tt31510819`) and Chicago P.D. (`tt2805096`). Scream VI (`tt17663992`, a movie) has all three sources.
- **TMDB `/person/{id}?append_to_response=combined_credits,external_ids`.**
  - Top level: `birthday` and `deathday` (`YYYY-MM-DD` or null), `place_of_birth`, `biography`, `known_for_department`, `imdb_id`, `external_ids.imdb_id`.
  - `combined_credits.cast[]`: `credit_id`, `media_type` (`movie` or `tv`), `id`, `title` or `name`, `release_date` or `first_air_date` (empty or missing for undated titles), `poster_path`, `genre_ids`, `character` (often empty), `episode_count` (tv only), `order`, `adult`.
  - `crew[]`: the same fields, with `department` and `job` instead of `character` and `order`.
  - A show's creator comes as `department: "Creator"`, `job: "Creator"`.
  - Crew departments seen: Production (Executive Producer, Producer, Executive Co-Producer, Production Manager, Production Assistant), Directing, Writing (Writer, Screenplay, Story, Teleplay, Idea, Original Film Writer), Creator, Editing, Art, and Crew (Thanks, In Memory Of, Presenter).
  - One person can have several cast credits on one show.
  - No `credit_id` repeats within a person.
  - Sizes: Isabel May has 28 cast and 2 crew; Tom Hanks 283 and 88; Steven Spielberg 238 and 284.
  - Self appearances: 163 of Tom Hanks's 283 cast credits are "Self" roles or on Talk or News titles. Roles seen: `Self`, `Self (archive footage)`, `Self - Guest`, `Self - Presenter`, `Self - Narrator`, `Himself`, `self`.
- **MDBList.** To confirm before Step 5 with a real key: the endpoint (expected `GET https://api.mdblist.com/tmdb/{movie|show}/{tmdbId}?apikey=`), how an unknown title answers, `ratings[].{source,value,score,votes}` for `imdb`, `tomatoes` and `metacritic`, the daily limit (documented 1,000 a day free, 1,000 reads per 5 minutes per account) and what a 429 looks like. Results go here.

## 1. Going back

`useCanGoBack()` in `@raven/ui` answers whether an in-app page sits behind the current one:

- **Browser router.** `window.history.state` carries react-router's `idx`, and the answer is `idx > 0`. This holds after a reload and after a `replace` on the first page, where the router's `'default'` key does not.
- **Memory router** (the desktop app, the tests). `window.history.state` has no `idx`, and the answer is `useLocation().key !== 'default'`, the check the player's `useLeave` makes today.

The player's `useLeave` uses it.

The web's `BackButton` takes `fallback: { to, label } | null`:
- With a page behind, it is a pill button "Back" that steps back (`navigate(-1)`).
- Without one, it is a pill link to `fallback.to` labelled `fallback.label`.
- With neither, it renders nothing.

Every page in the shell has one at the top of its header:

| Page | Fallback |
| --- | --- |
| Movie, Episode, Show, Season, Saga (through `ItemHeader`) | Their present `back` |
| Library | Libraries |
| History | Its library |
| Libraries, Person, Favourites, Settings, Design, Not found | Home (`/`) |
| Home | None |

## 2. Folders on a library card

`groupFolders(paths)` splits each path at its last `/`:
- It answers `{ parent, names }[]` in the order the parents first appear.
- A path directly under `/` has the parent `/`.

The card lists one line per parent: the parent in the mono font, then its folder names joined by " · ". The parents line up in a column. Below the card's 40rem container query, a line stacks the parent above its names.

## 3. A person's filmography

### Data

Migration 27:

- **On `people`:** `imdb_id`, `birthday`, `deathday`, `place_of_birth`, `biography`, `known_for` and `filmography_fetched_at`, all `TEXT` and nullable.
- **`person_credits`:**
  - `person_id` references `people` with `ON DELETE CASCADE`;
  - `credit_id`;
  - `type` (`movie` or `show`);
  - `tmdb_id`, `title`, `released`, `poster`;
  - `genre_ids` (a JSON array);
  - `department` (`Acting` for cast, otherwise TMDB's);
  - `role` (the character for cast, the job for crew);
  - `episodes`, `position`;
  - primary key `(person_id, credit_id)`.

`clearUp()` spares a person whose filmography was fetched in the last 180 days, so a viewed person keeps their id.

### Fetching

- **Single-flight.** One fetch per person at a time, at most 2 people at once.
- **First view.** The fetch runs inline with a deadline of 2,500 ms. Past it, the answer says `pending`, the fetch carries on, and the page asks again every 1,500 ms.
- **Stale.** A filmography older than 14 days is served as it is and fetched again in the background.
- **Failure.** A failed fetch is remembered for 10 minutes, so polling doesn't retry it.
- **Nothing to show.** With TMDB off, or failing with nothing stored, the answer says `unavailable` and the page shows the local credits as today.

### Departments and appearances

The department of a credit is decided in this order:
1. TMDB's `Acting` is `acting`.
2. A job containing "Producer" is `producing`.
3. `Directing` is `directing`.
4. `Writing` and `Creator` are `writing`.
5. Anything else is `crew`.

Crew jobs `Thanks` and `In Memory Of` are dropped.

An acting credit is an appearance as themselves when either is true:
- the title's genres include Talk (10767) or News (10763);
- its role matches `/^\s*(self|him\s*self|her\s*self|them\s*sel(f|ves)|host|co-host|guest host|presenter)\b/i`.

### Entries

- **One per title.** Its credits come with acting first.
- **`item`.** Set only when the title (matched on `type` and `tmdb_id`) has files on disk in a library the viewer can see. `viewer.seesItem` can't decide that alone: with nothing locked it says yes to items with no files.
- **Local credits.** Those TMDB doesn't list are added to their title's entry.
- **Order.** Undated titles first, then newest first, then by title.

### API

`GET /api/people/:id` answers `PersonDetails`:

```
{ id, tmdbId, name, photoVersion,
  profile: { imdbId, birthday, deathday, placeOfBirth, biography, knownFor } | null,
  credits: [...as today...],
  filmography:
    | { state: 'ready', fetchedAt, entries: FilmographyEntry[] }
    | { state: 'pending' }
    | { state: 'unavailable' } }

FilmographyEntry = { type: 'movie' | 'show', tmdbId, title, year, released, poster,
                     credits: Array<{ department, role, episodes, isSelf }>,
                     item: ItemSummary | null }
```

It depends on the cookie, so it is never `public` in `cache-control`. `GET /api/images/:use/:file` takes `?w=` for posters (`posterWidthFrom`), so thumbnails load small.

### Page

**Header:**
- the photo;
- the eyebrow "<known for> · <n> on raven";
- the name;
- "Born <date> in <place> · <age> years old", or "Born <date> in <place> · Died <date>, aged <age>";
- the biography, clamped to four lines with More and Less;
- links to IMDb and TMDB.

Dates are formatted in UTC so a birthday never slips a day.

**Toolbar:**
- a search over titles and roles (`useAddressSearch`, `?q=`);
- the "Show appearances as themselves" toggle, shown only when there are any;
- the tabs All, Acting, Directing, Writing and Producing, each with a count. A tab with nothing is hidden. They are links on `?credits=` that replace the address, so Back leaves the page.

**Table** (`aria-label` "Filmography"):

| Column | Shows |
| --- | --- |
| Year | The year, or "TBA" |
| Title | A small poster, the title and a Movie or TV mark |
| Role | Roles joined by " · ", then "<n> episodes" on a show |
| Department | All tab only |
| On raven | An "On raven" link to the title's page, or "Not on raven" with the title linking to TMDB |

- Year, Title and On raven sort.
- Department hides below a 48rem container and Role below 30rem.

**States:**
- A search with no match: `No titles match "<q>".`
- TMDB lists nothing: `TMDB lists no titles for <name>.`
- `unavailable`: the page groups as today, with `TMDB could not be reached, so this lists only what raven holds.`

## 4. Ratings from MDBList

Migration 28:
- `ratings.provider` (`tmdb`, `omdb` or `mdblist`, default `tmdb`; existing non-TMDB rows become `omdb`);
- `items.mdblist_fetched_at`.

**Which source answers:**
- With `MDBLIST_API_KEY` set and accepted, MDBList is the main source for movies and shows. OMDb is asked only for a title MDBList doesn't know.
- Without it, OMDb is the main source as today.

**Saving.** A provider's answer:
- deletes only the rows that provider wrote and no longer sends;
- never overwrites an MDBList row with an OMDb one.

**Topping up.** Due scores are topped up by a `ScoreSweep` on its own queue, never the metadata queue, within each provider's daily budget (`MDBLIST_DAILY_LIMIT`, default 1000). It wakes after UTC midnight when the budget is spent, and 15 minutes after a failure.

**Health.** It reports `mdblist` beside `omdb`.

## 5. Refresh

- **Route.** `POST /api/libraries/:id/refresh` (`@AdminOnly`) records the library's movies and shows in `score_requests` (migration 29), quick-scans the library and kicks the sweep. A second press while a refresh runs only quick-scans again.
- **Order.** Requested titles go first in the sweep, past the 30-day wait, with a light TMDB score fetch.
- **Status.** `Library.ratingsRefresh` is one of:
  - `idle` (`finishedAt`);
  - `running` (`done`, `total`, `startedAt`);
  - `waiting` (also `reason`: `budget` or `unavailable`, and `resumesAt`).
- **Card and header.** Refresh shows beside Rescan, under the admin lock. The status line reads `Refreshing ratings · <done> of <total>`, or `Ratings: <done> of <total> · the rest after midnight UTC (daily limit)`.
