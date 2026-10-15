# raven's smart scan: folder layouts, matching by library type, and an AI lookup

Date: 2026-10-12. Status: spikes run, outcomes below; open to review in the
PR. Decided with the user:

- an Anime library prefers anime and falls back;
- the AI lookup applies a confident pick and suggests the rest;
- Claude Haiku 5.5 is its default model, with a key raven has to itself.

## Goal

1. raven reads a library's folders however they are laid out: one folder per
   title at the root ("flat"), or letter folders (`A/`, `B/`, `#/`) and
   group folders (`Requests/`) that hold the titles. Grouping, pictures,
   NFOs and Fix match work the same either way.
2. A library's type steers matching. Anime shows and Anime movies prefer
   Japanese animation, Family libraries prefer family and animation, and
   Documentaries prefer documentaries.
3. With `ANTHROPIC_API_KEY` set, every show or movie the matcher leaves
   unmatched gets one Claude lookup over real TMDB results.

Success, measured against Vhagar's database and TMDB in the spikes:

- Anime Shows matches its 234 show folders to 234 shows, not 23.
- Vermithor's TV path matches its 680 show folders to 680 shows, not 27.
- No live-action pick in an Anime library where an animated title of the
  name exists (Avatar: The Last Airbender).
- Flat paths behave exactly as they do today: no rematch and no TMDB calls
  on upgrade.

## What happens today

- **Shows:** the show folder is the first folder segment
  (`parseEpisodeName` in `libs/raven/core/src/naming.ts`, `showFolderOf` in
  `apps/raven/server/src/metadata/places.ts`). In
  `A/Andor/Season 1/Andor - S01E01.mkv` the show is `A`, so:
  - every show under `A/` is one match group (`matchers.ts`,
    `groupBy({ key: showPlace })`), resolved once from its first file;
  - a Fix match on one of those shows re-points all of them;
  - posters and NFOs are looked for in `root/A`.
- **On Vhagar this is live.** In Vhagar's database, each letter of Anime
  Shows (11,049 files) and of Vermithor's TV path (17,062 files) is linked
  to one show whose title happens to contain that letter. `B/` is linked to
  Ultra B, `D/` to Initial D, `K/` to K, `M/` to M, and `Y/` to a Korean
  show called 궁금한 이야기 Y. Both letter sets land on the same items, and
  every one of those files reports `matched`.
- **Movies** mostly survive, because the movie parser reads the last folder
  segment. Two edge cases remain:
  - a letter folder with one loose movie in it claims `A/poster.jpg` as that
    movie's poster;
  - a letter folder named `Other` makes every file under it an extra.
- **The library type only picks movie, show or nothing**
  (`KIND_RULES[kind].matches`):
  - `MetadataService.pass` drops the kind;
  - `toSearchResult` drops `genre_ids` and `original_language`;
  - changing Movies to Anime movies rematches nothing.

## Design

### 1. Folder layout

**Container folders.** Each file's own path says whether the top folder of
its library path is a container, whose children are the titles. Nothing
about a library is stored or guessed, so nothing flips back and forth, and a
place refresh from the watcher reads files exactly as a full scan does. A
top folder is a container when one of these holds:

- **A letter folder:** its name is a single letter, `#`, `0-9` or a letter
  range such as `A-C`, in either case, and:
  - in a TV library, the file sits in a further folder that is not a
    season folder;
  - in a movie library, always.

  `K/Season 1/` in a flat anime library is the show K; `K/K/Season 1/` is
  letter K holding show K.
- **A group of shows** (TV libraries): the file's season folder sits two
  levels below it (`Requests/Cupertino/Season 1`), not directly under it.
- **A group of movies** (movie libraries): it has no year, and the folder
  below it has one (`Requests/25th Hour (2002)`).

`isLetterFolder` goes in core's `naming.ts`, and `containerOf({ kind, folder })`
in a new `libs/raven/core/src/folderLayout.ts`. Both are pure, and use
`seasonFolderNumber` and `findYear`.

**Title roots: the one seam.** The walker still finds files under library
paths. The scanner then gives each file the root its titles sit under:
`<library path>/<container>` when its top folder is a container, and the
library path otherwise.

`media.folder` is measured from that root. `rootOf`, `showFolderOf`,
`showDirOf`, `holdsOneMovie`, `fixGroup` and `match_overrides` then work
unchanged, because only `placeOf` in `mediaIndex.ts` reads `FoundFile.root`.
`titleRootOf({ root, path, kind, layout })` goes in a new
`apps/raven/server/src/scanner/layout.ts`. `MediaItem.folder`, which tiles
show, loses the container, so its comment in `contract.ts` changes to
match.

**The setting.** `folderLayout: oneOf(['auto', 'flat'])`, `auto` by default:

- `auto` reads containers as above;
- `flat` makes every top folder a title, today's behaviour, for a library
  whose single-letter or group folder names are really titles.

**What a path looks like.** After each full scan, `library_paths.layout`
(`oneOf(['flat', 'lettered', 'mixed'])`) records what the path turned out
to be, for the dialog. Nothing reads it to decide anything. The Library
response gains `layouts: listOf(object({ path, layout: nullable(...), containers }))`.

**Storage.** One migration adds `libraries.folder_layout TEXT NOT NULL DEFAULT 'auto'`
and `library_paths.layout TEXT`.

**Relayout.** Re-deriving the title roots of a library's files runs:

- once for every library, on the first boot after the upgrade, under a
  marker so it never repeats;
- when `folderLayout` changes;
- with `MatchFiles.rename` when the kind changes between movie and show
  rules.

Only files whose `folder` changes are touched, so a flat path is left
alone. For those files, one transaction:

1. Writes the new `folder`, and reads the name again (`namedAs`).
2. Maps the `match_overrides` places through those files: each file's old
   folder, show and file places become the new ones.
   - An override whose old place maps to exactly one new place moves
     there.
   - One that maps to several (an old `A` show folder override, made under
     the broken grouping) is dropped.
3. Clears matches where the grouping changed:
   - in a TV library, the files are unlinked and go pending, since their
     groups changed;
   - a movie library keeps its links unless a re-read title or year changed.
4. Queues a pass.

**UI.** `LibraryDialog` gets a Folder layout choice: "Read letter and group
folders" (auto) or "Every top folder is one title" (flat). Under it, each
path shows what it was read as, such as "Letter folders (27)", "One folder
per title" or "Mixed". Saving a different choice runs a relayout, with no
rescan.

### 2. Matching by library type

**Tiers.** `KindRules` gains `prefer: readonly CandidateTier[]`. A
`CandidateTier` is `{ genres?, languages?, countries? }`. A result fits a
tier when:

- it has one of the tier's genres, if any are listed;
- and its original language or one of its origin countries is in the
  tier's lists, if any are listed.

The rules are written `as const satisfies` and the types read off them.
TMDB uses the same genre ids for movies and TV here: Animation 16,
Family 10751, Documentary 99.

| Kinds | Tiers, in order |
| --- | --- |
| `animeShows`, `animeMovies` | Animation from Japan (`ja` or `JP`), then any animation, then anything |
| `familyShows`, `familyMovies` | Family or Animation, then anything |
| `documentaries` | Documentary, then anything |
| `movies`, `shows` | anything (today's behaviour) |

**Picking.**

- `SearchResult` keeps `genreIds` and `originalLanguage`
  (`tmdbClient.ts`, `toSearchResult`). `countries` is already kept for TV.
- `pickByTiers` in `metadata/matcher.ts` runs `pickMatch` over each tier's
  results in turn, and the first pick wins. The lone-result rule applies
  only on the unfiltered tier, so a filter never turns "one result left"
  into a guess. The alias lookup and the adult retry go through the same
  tiers.
- `MetadataService.pass` hands the kind down, not only the type.
  `MatchPass` takes the tiers, and its search cache key gains the tier set,
  since that cache stores picks, not raw results.

**No retry without the year.** The spike tried searching TV again without
`first_air_date_year` when the year-filtered search picked nothing. Two of
its four rescues were wrong: `Monster (2022)` became the 2004 anime, and
`Patriot (2017)` a 2018 Chinese drama. raven never guesses, so those groups
stay unmatched and go to the AI lookup, which searches without the year
itself.

**Changing a library's type.** `librariesController.update` rematches when
the tiers change, not only the type, so Movies to Anime movies now
rematches. Fix match choices stay. `movies.test.ts` (around 744 to 772) and
`shows.test.ts` (around 257) assert the old behaviour and change with it.

**Fix match.** `GET /api/match/search` takes an optional `libraryId`, and
candidates that fit the library's first tier sort first.

### 3. AI lookup for what is left

**Config**, read in `config.ts` like `OMDB_API_KEY`:

| Variable | Default | What it does |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | unset | Turns the lookup on. Never logged or sent to a client |
| `AI_MATCH_MODEL` | `claude-haiku-5-5` | The model the lookup uses |
| `AI_MATCH_EFFORT` | `low` | `output_config.effort`; the spike found `low` enough |
| `AI_DAILY_LIMIT` | 200 | Lookups a day, reset at UTC midnight like OMDb's |

All four go in `apps/raven/.env.example` and the README's env table.
raven's own key goes in Vhagar's `/volume1/docker/raven/.env`.

**Client.** `@anthropic-ai/sdk` joins `@raven/server`'s dependencies. Its
client takes a `fetch` option (checked on 0.133.0), so it is built with the
key and a fetch injected under a DI token like `METADATA_FETCH`, and tests
fake it the same way.

**`AiMatcher`** (`metadata/aiMatcher.ts`).

When it runs: after a pass, for each group left unmatched (a show folder
or a movie group) that has no "not a match" Fix match and no earlier
decision. One lookup per group, two at a time.

What Claude is sent:
- the library type and layout;
- the group's place;
- up to 12 file names;
- the parsed title, year and show name from the file;
- the searches already tried.

No absolute path, and nothing outside the library.

Tools, strict, with `tool_choice: auto`:
- `search_tmdb({ type, query, year })` (year nullable) runs through
  `TmdbClient`, so its rate limit applies. It returns up to 10 candidates:
  id, title, original title, year, genre names, language, countries and a
  200 character overview.
- `list_episodes({ tmdbId, season })` returns a season's episode numbers
  and titles, so Claude checks the files' numbering against a candidate's.
  This was the difference between a wrong low pick and a right high one
  for Doctor Who.
- `choose_match({ tmdbId: string | null, confidence: 'high' | 'low', reason })`.

Tool inputs are checked with guards built from the `schema.ts` combinators.

Limits and checks:
- At most 6 turns. Ending without `choose_match` means no decision.
- A chosen id must be one that `search_tmdb` returned in the same lookup,
  or it is thrown away.

Request settings:
- adaptive thinking, the default;
- `max_tokens` of 4000;
- the stable system prompt and tools cached with `cache_control`.

Haiku 5.5 has no server-side refusal fallback, so a `refusal` counts as no
decision.

**Storage.** A migration adds
`ai_decisions(library_id, place, tmdb_id, confidence, reason, model, decided_at, PRIMARY KEY (library_id, place))`.
`tmdb_id` is NULL when Claude found nothing.

- Every lookup is recorded, so a group is never asked twice.
- Match again clears the undecided rows (NULL `tmdb_id`), so those are
  asked again.

**Applying.** `MatchPass.resolve` runs in this order:

1. Fix match.
2. An id in a name or NFO.
3. Search.
4. A `high` AI decision.
5. Unmatched.

- A `high` pick matches as `matched`, and the item page says "Matched by
  AI" with its reason.
- A `low` pick leaves the files unmatched, with the pick as a suggestion.
  The unmatched listing gains
  `aiSuggestion: nullable(object({ tmdbId, title, year, poster, reason }))`.
- Accepting a suggestion is the existing Fix match call (`setMatch` or
  `setItemMatch`). It writes a user override, which then always wins.

**Health.** `MetadataHealth` gains `ai: oneOf(['off', 'ok', 'failing'])`
and `aiRemaining`.

**Privacy.** The file and folder names of matched libraries go to
Anthropic. Sports, YouTube and Other libraries are never matched, so their
names are never sent.

### 4. Web

- **`LibraryDialog`:**
  - the Folder layout choice, and what each path was read as;
  - when the key is unset, the hint "Set `ANTHROPIC_API_KEY` in raven's
    `.env` to look up titles the matcher misses", after the
    `TMDB_API_TOKEN` hint.
- **Not matched tab:** a suggestion card showing the poster, "Suggested:
  Archie: The Man Who Became Cary Grant (2023)", the reason, and Accept or
  Fix match.
- **Item pages and the Fix match dialog:** a "Matched by AI" note with the
  reason. Fix match works as it does today.

## Spike outcomes

All three ran on 2026-10-12 against a read-only snapshot of Vhagar's
database (schema version 15) and the live TMDB API, from the session
scratchpad. No spike code is in the repo.

### S1 Layouts

From the snapshot, every library path:

| Read as | Paths |
| --- | --- |
| Letter folders | 4K Movies, Movies, Anime Shows, `vermithor/Media/TV`; also Home Videos and Tutorials, which are Other libraries and never matched |
| One folder per title | 4K TV, Reality TV Shows, Documentary Shows, Classics, Sitcoms, Mini-Series, UFC, Assignments |

- TV Shows mixes six flat paths with one lettered one, so the rule has to
  work per path, or per file as above, never per library.
- Lettered paths hold group folders as well: `Requests/` in Movies and in
  Vermithor's TV, and `_Trash_Review/` in Movies. Read by letters alone,
  every show in `Requests/` would be one show called "Requests".
- The container rule, run over every file in every flat path, picks out no
  folder at all. In lettered paths it picks out exactly the letters,
  `Requests/` and `_Trash_Review/`.
- The only single-letter oddity is `S/Season of the Witch (2011)`, which
  `seasonFolderNumber` already reads as a movie, not a season.

### S2 TMDB

raven's own `parseEpisodeName` and `pickMatch` ran over every show folder,
with letter and group folders as title roots, searching TMDB's TV endpoint
and its alternative titles as the matcher does.

**Anime Shows** (234 folders, 11,049 files, 258 calls):
- today's rules match 233; 6 of those match through alternative titles;
- the anime tiers change exactly one pick, Avatar: The Last Airbender,
  from the 2024 live-action series to the 2005 animated one;
- 13 shows that match are animation from outside Japan: Castlevania, Blue
  Eye Samurai, Scavengers Reign, and Chinese donghua such as TO BE HERO X.
  They match through the "any animation" tier, which is why the tiers fall
  back past Japan;
- 1 stays unmatched: `Ninja Scroll`, which has no year and hash file names.

**Vermithor's TV path** (680 folders, 17,062 files, 731 calls):
- today's rules match 676; 11 of those match through alternative titles;
- `Requests/` read as a container matches its four 2026 shows;
- 4 stay unmatched because the folder's year disagrees with TMDB:
  `Cowboy Bebop (2020)`, `Doctor Who (2023)`, `Monster (2022)` and
  `Patriot (2017)`. Searching them again without the year was the retry
  dropped above.

TV Shows' flat paths have 3 unmatched groups in the snapshot: Australia
Remastered, a Wild Arctic folder whose name is misspelt on disk (the files
say Destination Wild - Arctic), and Archie. Every movie is matched. So once
letter folders are read, about 8 groups across every library are left for
the AI lookup.

### S3 AI

The lookup ran over those 8 groups, plus `Cesar 911+ Cesar To The Rescue`
as a control: today it is wrongly matched to Cartoon Network to the Rescue.
Three runs on Haiku 5.5:

| Run | High picks | High and right | Low picks | Cost for 9 lookups |
| --- | --- | --- | --- | --- |
| `low` effort, search only | 4 | 4 | 5 (Doctor Who wrong) | $0.0062 |
| `medium` effort, search only | 3 | 3 | 6 (same picks) | $0.0081 |
| `low` effort, with `list_episodes` | 6 | 6 | 3 | $0.0093 |

- With `list_episodes`, every high pick checked the files' episode titles
  against the candidate's: Ninja Scroll: The Series (2003), Cowboy Bebop
  (2021), Doctor Who (2024), Patriot (2015), Australia Remastered (2020)
  and Wild Arctic (2018).
- The low picks were the cases a person should look at:
  - DAHMER - Monster (2022): two Season 2 files that TMDB lists no season
    for.
  - Archie: The Man Who Became Cary Grant (2023): generic episode titles.
  - The Cesar control, where it chose nothing: Season 1's files really are
    episodes of another show, misnamed on disk.
- No run returned an id it had not been offered.
- At about $0.001 a lookup, the daily limit of 200 costs at most about 20
  cents a day.

Decisions taken from this: Haiku 5.5 stays the default, effort `low`, and
`list_episodes` joins the tools.

## Order of work

One PR per step, each branched from the one before, built by subagents
(an implementer and a reviewer per task). Step 2 carries almost all the
value on Vhagar: about 28,000 files move from 50 letter-sized groups to 914
shows.

1. **This spec, with the spike outcomes and the plan for step 2.**
2. **Folder layout:**
   - `isLetterFolder` and `containerOf` in core;
   - the migration;
   - title roots and relayout, including the boot-time pass;
   - the setting, and the dialog's choice with what each path was read as.
3. **Matching by type:**
   - the tiers;
   - the kept search fields;
   - rematch on a type change;
   - Fix match ranking.
4. **AI lookup, server:**
   - config and the SDK;
   - `AiMatcher`, its three tools and `ai_decisions`;
   - health.
5. **AI lookup, web:** suggestions, the "Matched by AI" note, and the hints.

## Work in flight this touches

- **Migrations:** the transcoding spec's S1 (`probe_version`) also appends
  one. Whichever lands second goes after the other, and a migration that
  has shipped is never edited or reordered.
- **`@raven/ui` extraction** (desktop step D1): it moves `LibraryDialog`,
  `FixMatchDialog` and `SectionViews`. Steps 2, 3 and 5 either land before
  it or rebase onto it.
- **`librarySections.ts`:** the desktop spec moves it into
  `libraryKinds.ts`, where the tiers also live.

## Testing

- **Core:**
  - `containerOf` tables:
    - letters, `#`, `0-9` and `A-C`, in TV and movie libraries;
    - `K/Season 1` versus `K/K/Season 1`;
    - `Requests/Cupertino/Season 1` and `Requests/25th Hour (2002)`;
    - `S/Season of the Witch (2011)`;
    - a show folder with no season folders;
    - a franchise folder such as `Star Trek/Star Trek - The Next Generation/Season 1`;
  - `isLetterFolder`;
  - whether a result fits a tier.
- **Server:**
  - Scans over temp trees in both layouts, in the style of `walk.test.ts`,
    including a place refresh inside a letter folder.
  - `matchers.test.ts`: under letter folders each show is its own group,
    and `showDirOf` finds `A/Andor/poster.jpg`.
  - A relayout test: a lettered library indexed the old way is upgraded;
    overrides move or are dropped, shows rematch, movies keep their links,
    and a flat library is not touched.
  - A migration test in `database.test.ts`.
  - `matcher.test.ts`:
    - Avatar: The Last Airbender picks the 2005 series in Anime shows, and
      the more popular 2024 series in TV shows;
    - a Chinese donghua matches in Anime shows through the animation tier.
  - A rematch on a type change.
  - `fakeTmdb.ts` returns `genre_ids` and `original_language`.
  - `AiMatcher` with a fake fetch:
    - a `high` pick applies and a `low` one is suggested;
    - an id that was never returned is thrown away;
    - the daily limit stops lookups;
    - a decided group is not asked again;
    - a refusal or a missing `choose_match` is no decision.
- **Web:**
  - the Folder layout choice;
  - accepting a suggestion;
  - the "Matched by AI" note.
- **On Vhagar:** after step 2 deploys, Anime Shows lists 234 show cards with
  posters from each show's folder, and Vermithor's TV path 680. After step
  4, the Not matched tab holds only what the lookup marked low.

## Out of scope

- Absolute episode numbers and TMDB episode groups, such as anime seasons
  split into separate folders like `Mob Psycho 100 II`.
- Other providers (AniList, AniDB).
- AI re-checking matches that already exist, though the Cesar control
  shows it can spot a misnamed group. That is a follow-up worth its own
  spec.
- Nested containers (a letter folder inside a group folder).
