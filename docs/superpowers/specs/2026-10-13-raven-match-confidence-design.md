# raven match confidence

Fix match lists TMDB's results for a folder or file, and the viewer picks one. Today every result looks alike, so choosing between "Monster" (2004) and "Monster" (2016), or spotting that "Monster High" cannot be a folder of 35 episodes of season 1, takes reading every overview. This adds a match confidence from 0 to 100 to every result, shows it as a stamp on the poster with the tier named under the year, orders the results best first, and names the best match when one clearly is.

## What the viewer sees

- Every result in Fix match carries a confidence from 0 to 100, in one of three tiers: **Strong** (80 to 100), **Possible** (50 to 79) and **Weak** (0 to 49).
- A band across the bottom of the poster holds the number: a check and the number on fern for Strong, the number on amber for Possible, lichen on night with a 3:1 top edge for Weak.
- Under the year, a line names the tier: "Strong match", "Possible match" or "Weak match". The top result says "Best match" with a check instead, in fern, and its row gets a fern outline, only when it is Strong.
- Results come best first. Today's order (the library type's preferred tier first, then TMDB's) breaks ties.
- Below `30rem` the Choose button moves under the row so the title and overview keep their width at 320px.

The design was chosen from four mockups (pill, ring, meter, poster stamp) in the brainstorming companion; this is the poster stamp, D.

## Scoring

### Against what

- The title and year come from the search fields. They start as the folder's name, so a viewer who corrects a typo is scored against the correction.
- The fit and the country come from what is on disk: the files of the folder or show being fixed (the subject).

### Signals

The title says how likely a result is at all; the other signals, the support, say how well the rest agrees. The title multiplies, so a result whose name is not the folder's stays low however well the rest agrees:

`score = round(100 × title × (0.6 + 0.4 × support))`

**Title**, from 0 to 1: 1 when the result's title, original title or one of its TMDB aliases folds (`foldTitle`) to the searched title. `foldTitle` keeps only Latin letters and digits, so a title with none (몬스터, モンスター) is compared lower-cased and trimmed instead; otherwise a search in Korean would be every Korean result's exact title. Otherwise 0.8 × the folded titles' similarity, `1 − Levenshtein distance / the longer length`, so a typo stays close and extra words do not: "Wild Artic" against "Wild Arctic" is 0.73, "Monster High" against "Monster" 0.47, "Monster: The Lizzie Borden Story" 0.18.

**Support**, from 0 to 1: the weighted mean of the supporting signals that can be measured. One that cannot (no year asked, no subject, no runtime from TMDB) is left out of the sum and of the weights both. When none can, the support is 1, so an exact title on its own is 100.

| Signal | Weight | Value |
| --- | --- | --- |
| Year | 30 | Measured when a year is asked. The same year 1, one either side 0.8, within three 0.4, otherwise 0. A result with no year is 0. |
| Fit | 20 | Measured when the subject gives one and TMDB's details were read. Shows: 1 when every file on disk fits the show (below), else 0. Movies: 1 when TMDB's runtime is within 10 minutes of the file's duration, 0.5 within 25, else 0. |
| Library type | 5 | Measured when the library's first tier filters (`isUnfiltered` is false): 1 when the result fits it (`fitsTier`), else 0. |
| Popularity | 5 | Measured for a result whose title is 1 and that is not from another country (below), when some such result has a popularity above 0: its popularity over the highest among them. It only tells apart results that share the title, as `pickMatch`'s does. |

**Changed from the brainstorm, on purpose.** The brainstorm summed the title (50) with the rest. Worked through, that gave "Monster High" 57 against a "Monster" folder, Possible, because fit and popularity added points whatever the title. The title now multiplies; the partial title is edit distance rather than shared words, so a typo reaches Possible; the year weighs 30, so an exact title six years off with a fit is Possible rather than Strong; and popularity is compared only among results with the title, so a lone exact title is not marked down by a more popular different show.

A show's file fits when its season (above 0) holds its highest episode in TMDB's season list, when it is in season 1 and its highest episode is within the show's episode total (one season on disk numbered straight through), or when its absolute number is within the total. Files with no numbers, and season 0, are left out. A subject with no file left out of that measures no fit.

### Caps, applied in order

1. **Does not fit.** A fit of 0 caps the score at 40: a show without an episode on disk, or a movie two hours long against a 22 minute file.
2. **Another country.** When the subject's name gives a country ("The Office (UK)", read by `parseEpisodeName`), or the searched title ends in one, a show whose countries do not include it is capped at 40. Movies' search results carry no countries, so it never applies to them.
3. **Close call.** Take the highest score. When it is 80 or more and another result is within 10 points of it, every result within 10 points of it is capped at 79. Two results that both fit, and that nothing tells apart, are both Possible, and no result is named Best match.

### Details for the top five

TMDB's search results carry no episode counts, runtimes or aliases. The results are scored once without fit or aliases, and the five highest have their details read: one call each, `/tv/{id}` or `/movie/{id}` with `append_to_response=alternative_titles`, which gives the seasons and their episode counts (or the runtime) and the aliases in one answer. They go through `TmdbClient`'s rate limiter, in parallel, and are kept in memory for a day, up to 500, so searching again costs nothing. Then all results are scored again. A details call that fails leaves that result without fit or aliases; the search never fails for it.

### Worked example: the "Monster" folder

35 files `Monster - S01E01` to `S01E35`, in a TV shows library (which does not filter), no year in the search.

- Monster (2004): title 1; support from fit 1 (season 1 has 74) and popularity 1 is 1: 100.
- Monster (2016): title 1; fit 1 (season 1 has 50), popularity 0.2, so support (20 + 1) / 25 = 0.84: 100 × (0.6 + 0.336) = 94.
- Close call: both within 10 of 100, so both are 79, Possible. No Best match.
- Monster High (2022): title 0.47, so at most 47 whether it fits or not: Weak.
- Monster: The Lizzie Borden Story: title 0.18: at most 18.

Without a subject (a search typed from scratch), the fit is not measured and popularity alone is the support: Monster (2004) is 100, Monster (2016) 0.6 + 0.4 × 0.2 = 68, and Monster (2004) is the Best match, as auto-matching would have chosen it.

## API

- `isMatchCandidate` gains `confidence: isNumber`, a whole number from 0 to 100.
- `libs/raven/core/src/matchConfidence.ts` holds the tiers: `isConfidenceTier = oneOf(['strong', 'possible', 'weak'])`, `CONFIDENCE_STRONG = 80`, `CONFIDENCE_POSSIBLE = 50` and `confidenceTierOf(score)`. The server's close call and the web's badge read the same thresholds.
- `isMatchSubject` in the contract: `{ kind: 'media', id }` for a file (and its folder), `{ kind: 'item', id }` for a matched show. `api.searchMatches` takes an optional `subject` and sends it as `mediaId=` or `itemId=`; the web's query key includes it.
- `GET /api/match/search` takes `mediaId` or `itemId` (both is a 400, a malformed id is a 400, as `libraryId` is). The subject is read only when the browser may see its library, by the rule `preferredBy` follows; one it may not, or one raven no longer has, is no subject, never an error, so the answer never tells a hidden library is there.

## Server

- `apps/raven/server/src/metadata/matchConfidence.ts`: `scoreCandidates`, a pure function. It takes the searched title, year and country, the results in today's order, the library's first tier, what the subject has on disk and the details read for some results, and answers each result's confidence. No I/O, so its tests call it directly.
- `apps/raven/server/src/metadata/matchFactsCache.ts`: `MatchFactsCache`, an injectable service over `TmdbClient.matchFacts` with the in-memory cache. `TmdbClient.matchFacts({ type, tmdbId })` reads the details call above into `MatchFacts`, a discriminated union: `{ type: 'show', aliases, seasons, episodeCount }` or `{ type: 'movie', aliases, runtime }`.
- `MatchController.search` resolves the subject (a show folder's files through `MatchFiles.underFolder`, a matched show's through `MatchFiles.under`, a movie's duration from `MediaRepository.get`), scores once, reads the top five's details, scores again, and sorts by confidence, stable over today's order.

## Web

- Tokens in `apps/raven/web/src/styles/globals.scss`: `--color-fern: #8fcf9f` (9.2:1 on `--color-night`) and `--color-amber: #e3b45f` (8.7:1), with a comment that their one job is match confidence, so the red leaves keep their two; and `--color-moss-line: #5d736c`, a 3:1 edge on night.
- `FixMatchDialog` takes a `subject` and passes it to the search. Its four callers give one: `MediaMenu` and `SuggestedMovies` the file, `UnmatchedShows` the folder's first file, `ShowPage` the show.
- The candidate row stacks the stamp over the poster in a named grid area. The tier line sits under the year. The row of a Strong top result gets the fern outline.

## Accessibility

- Never colour alone: the number and the tier word are always text; the colour repeats them.
- Contrast: every text clears 4.5:1 on the row (fern 9.2:1, amber 8.7:1, lichen 7.3:1); the Weak stamp's edge clears 3:1.
- The stamp is `aria-hidden`. The tier line carries hidden words after its tier, "Best match, confidence 94 out of 100", and each Choose button is `aria-describedby` it, so tabbing through the results announces the score with the title.
- No hover-only detail. No motion is added.
- In forced colours the stamp keeps a border.

## Testing

- Core: `confidenceTierOf` at 0, 49, 50, 79, 80 and 100; `isMatchCandidate` with and without `confidence`; `isMatchSubject`; `searchMatches` sending the subject.
- Server, `scoreCandidates`: an exact title alone is 100; an alias or the original title counts as the title; partial titles by edit distance (a typo Possible, extra words Weak); the year steps; support left at 1 when nothing is measured, and averaged over only what is; popularity only among results with the title; fit for shows (season, season 1 straight through, absolute, season 0 and unnumbered files left out); fit for movies (10 and 25 minutes); both caps; the close call, and none below 80; the worked example above, number for number.
- Server, the endpoint: `confidence` on every result; best first with today's order breaking ties; only five details calls, and none the second time; a failed details call still answers; the subject read through `mediaId` and `itemId`; a hidden library's subject ignored; `mediaId` with `itemId`, or a malformed id, a 400. The existing order tests keep passing or change only where the new order is meant.
- Web: the stamp and tier line per tier; Best match only on a Strong top result; Choose described by its tier line; each caller's subject reaching the search.

## Order of work

Two stacked PRs:

1. **Scoring** (branch `raven-match-confidence-server`): this spec and the plans, the core contract and tiers, `TmdbClient.matchFacts`, `MatchFactsCache`, `scoreCandidates`, the endpoint, the client's `subject`, and the web's test data given a `confidence` so it keeps passing. The dialog looks as it does today, ordered best first.
2. **The badge** (branch `raven-match-confidence-web`, on step 1): the tokens, the stamp and tier line, Best match, the callers' subjects and the narrow layout.

## Out of scope

- Scoring with the AI lookup's decisions.
- Confidence anywhere but Fix match (the Not matched list, the AI suggestion card).
- Showing why a result scored what it did.
