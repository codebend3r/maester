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
- **MDBList, from its public OpenAPI schema (`https://api.mdblist.com/schema/`, read 2026-10-17 without a key):**
  - **One title:** `GET https://api.mdblist.com/tmdb/{movie|show}/{tmdbId}/?apikey=<key>`. The key goes in the `apikey` query parameter.
  - **What it answers:** `{ id, imdb_id, title, year, type, score, ratings: object[] }`. The schema doesn't spell out a rating's fields.
  - **A bad key** answers `401 {"error":"Invalid API key"}`. This was checked against the live API.
  - **Daily limit:** per account, shared by all of its keys. The free tier gets 1,000 requests a day, reset at 00:00 UTC. Successful answers report it in `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (a Unix time).
  - **5-minute limit:** 1,000 reads per fixed window.
  - **Going over either limit** answers `429` with `Retry-After`. The `error` field reads `Daily API limit exceeded!` or `API rate limit exceeded!`.
  - **Batches:** `POST /tmdb/{movie|show}/` takes `{ ids }`, and `POST /rating/{movie|show}/{source}` takes up to 10 ids on the free tier, but returns one source per call.
- **Still to confirm with a real key:**
  - each rating's fields, expected `{ source, value, score, votes }` with sources `imdb`, `tomatoes` and `metacritic`, `score` out of 100;
  - how an unknown title answers;
  - the media batch's size limit.

  raven starts with one title per call, which allows 1,000 titles a day. Batching is a later step.

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

`foldersByParent(paths)` splits each path at its last `/`:
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
- **Who starts it.** A first fetch starts only for a viewer who can see at least one of the person's titles. A person whose titles are all hidden from the viewer is never looked up.
- **A full line.** At most 2 lookups run and 20 wait. Past that, the answer says `pending` without queueing, and the page's next ask tries again.
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
- With `MDBLIST_API_KEY` set and accepted, MDBList is the main source for movies and shows. OMDb is also asked for a title MDBList doesn't know or couldn't answer: at once when MDBList answers unknown, and in the sweep's fallback pass whenever OMDb's answer is missing or a month old, so a failed fallback is asked again.
- Without it, or once MDBList's calls for the day are spent, OMDb is the main source as today.

**Saving.** A provider's answer:
- deletes only the rows that provider wrote and no longer sends;
- never overwrites an MDBList row with an OMDb one while MDBList's answer is under 30 days old. Past that, OMDb's answer replaces it, so scores from an MDBList key that has gone away do not freeze.

**Topping up.** Due scores are topped up by a `ScoreSweep` on its own queue, never the metadata queue, within each provider's daily budget (`MDBLIST_DAILY_LIMIT`, default 1000):
- It is kicked on start, after each matching pass and after each daily sweep.
- It drains the main source's due titles, then OMDb's for the titles MDBList doesn't know.
- OMDb is due for a title with an IMDb id when its own answer is missing or a month old, and MDBList's is too or MDBList gave the title no scores.
- It wakes after UTC midnight whenever a spent source still has titles due.
- A round stops after three failed calls in a row, and a round with failures and no answer ends the drain.
- Later rounds and drains skip the titles a source failed on, until a drain gets an answer from that source or every title due from it has failed. Titles that keep failing at the head of the list then cost one call each per try, and each try reaches four titles further down.
- It wakes 15 minutes after a drain that asked and got no answer at all. A drain that answered and left failures behind waits for the next kick: a matching pass, the daily sweep, or midnight when a budget is spent. A Refresh's titles are the exception (section 5).

**Health.** It reports `mdblist` beside `omdb`.

## 5. Refresh

- **Route.** `POST /api/libraries/:id/refresh` (`@AdminOnly`) records the library's movies and shows in `score_requests` (migration 29), quick-scans the library and kicks the sweep. A second press while a refresh runs only quick-scans again.
- **Order.** Requested titles go first in the sweep, past the 30-day wait, with a light TMDB score fetch. A request makes a title due from a provider until that provider answers after the Refresh began, so each provider is asked once a Refresh. The rule sits in the one predicate that both lists due titles and checks one, and a round that asks nothing while its source is still the one to ask ends the drain.
- **Settling.** A request is settled by the source that can answer it in full:
  - MDBList while its key is set and not refused, its calls spent or not. OMDb's answer on a day MDBList's calls are spent leaves the request, as OMDb has no Rotten Tomatoes or Metacritic score for a show.
  - Else OMDb while its key is set and not refused.
  - Else TMDB's score alone.

  Should that source change mid-Refresh (a key refused or taken away), what the new one already answered since the Refresh began settles too.
- **Retries.** A drain that leaves requests the settling source can still be asked for today wakes 15 minutes later, so a requested title that failed is asked again then, not the next day.
- **Status.** `Library.ratingsRefresh` is one of:
  - `idle` (`finishedAt`);
  - `running` (`done`, `total`, `startedAt`);
  - `waiting` (also `reason`: `budget` or `unavailable`, and `resumesAt`). `budget` covers the sweep's own pause and a day the settling source's calls are spent while another source still has calls.
- **Card and header.** Refresh shows beside Rescan, under the admin lock. The status line reads `Refreshing ratings · <done> of <total>`, or `Ratings: <done> of <total> · the rest after midnight UTC (daily limit)`.
