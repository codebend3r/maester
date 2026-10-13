# raven match confidence, step 2: the badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix match shows each result's confidence as a stamp across the bottom of its poster and a tier line under its year, names the best match when the top result is Strong, and scores every search against the file or show it was opened for.

**Architecture:**
- `FixMatchDialog` takes a `subject` (`MatchSubject` from `@raven/core`) and passes it to `matchSearchQuery`, whose key includes it. Its four callers give one: `MediaMenu` and `SuggestedMovies` the file, `UnmatchedShows` the folder's first file, `ShowPage` the show.
- Each `Candidate` row reads `confidenceTierOf(candidate.confidence)`: the stamp is layered over the poster in a named grid area, `aria-hidden`; the tier line holds the words a screen reader hears, and Choose is `aria-describedby` it.
- The server already orders the results best first (step 1), so the first result is the best match when it is Strong.

**Tech Stack:** React 19, TanStack Query, SCSS modules, bun test with happy-dom and Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-13-raven-match-confidence-design.md`: "What the viewer sees", "Web", "Accessibility", the web part of "Testing", and "Order of work" step 2. It builds on step 1 (`2026-10-13-raven-match-confidence-server.md`).

## Global Constraints

- Every rule in the root `CLAUDE.md` holds:
  - no `any`, no casts, no non-null assertions outside tests;
  - `type`, never `interface`; no enums;
  - named exports only;
  - no `for`, `for...of` or `for...in` loops;
  - one object parameter wherever there are two or more;
  - `@/` imports with no extension, SCSS modules included;
  - `&&` in JSX, never a ternary with a `null` branch;
  - no em or en dashes anywhere, UI copy included.
- CSS:
  - component styles are SCSS modules;
  - layout is grid with `gap` and padding, never flex, never margins;
  - fixed regions are placed with named `grid-template-areas`, overlays by giving several children the same named area;
  - colors, fonts, sizes, line heights, spacing and radii come from `apps/raven/web/src/styles/globals.scss`; the three new colors are added there;
  - desktop-first at the thresholds already in use (`30rem` here), and the dialog works at 320px wide;
  - no animation or transition is added;
  - stylelint: `value-keyword-case: lower`, so the forced-colors border is `canvastext`, not `CanvasText`.
- Accessibility: never colour alone; text at 4.5:1 or more (fern 9.2:1, amber 8.7:1, lichen 7.3:1 on `--color-night`); the Weak stamp's edge at 3:1 (`--color-moss-line`); the stamp `aria-hidden`; Choose described by its tier line; a border in forced colours.
- The copy, binding: "Best match", "Strong match", "Possible match", "Weak match"; the hidden words after them, ", confidence 94 out of 100".
- From step 1, consumed as they are: `MatchCandidate.confidence`, `MatchSubject` (`{ kind: 'media'; id } | { kind: 'item'; id }`), `confidenceTierOf`, `ConfidenceTier`, and `api.searchMatches({ ..., subject })`. The web tests' candidates already carry a `confidence`.
- Run tasks through Nx from the repo root: `bunx nx run @raven/web:test`, one file with `-- <path>` (as in `bunx nx run @raven/web:test -- src/components/FixMatchDialog/FixMatchDialog.test.tsx`), `bunx nx run @raven/web:typecheck`, `bunx nx run @raven/web:lint:ts`, `bunx nx run @raven/web:lint:css`, `bunx nx run @raven/web:format` before every commit, and `bun run verify` before the PR.
- Commits follow the `commit-format` skill: a `MAE:` subject, a short bullet body written with a heredoc, backticks around code, and no agent attribution or vendor name.
- Branch `raven-match-confidence-web` from `raven-match-confidence-server` once step 1 is committed. The PR is stacked on step 1's PR.

## Review Focus

- **A search whose results are all Weak or Possible**: expect no "Best match" anywhere and no fern outline. Pinned in Task 2.
- **A result with no poster**: expect the stamp still across the bottom of the placeholder initial, readable. Pinned in Task 2.
- **A long title at 320px**: expect Choose under the row, the title wrapping, and the tier line on its own line. Checked by eye in Task 2, step 9.
- **The viewer typing a new title**: expect the subject kept, so the new results are still scored against the folder. Pinned in Task 1.
- **A Strong result that is not the first** (two Strong results more than 10 apart): expect "Strong match" on the second, "Best match" on the first only. Pinned in Task 2.

---

### Task 1: The search names its subject

**Files:**
- Modify: `apps/raven/web/src/lib/queryClient.ts` (`queryKeys.matchSearch`)
- Modify: `apps/raven/web/src/lib/queries.ts` (`matchSearchQuery`)
- Modify: `apps/raven/web/src/components/FixMatchDialog/FixMatchDialog.tsx` (`subject` prop)
- Modify: `apps/raven/web/src/components/MediaMenu/MediaMenu.tsx`, `apps/raven/web/src/components/SuggestedMovies/SuggestedMovies.tsx`, `apps/raven/web/src/components/UnmatchedShows/UnmatchedShows.tsx`, `apps/raven/web/src/pages/ShowPage/ShowPage.tsx`
- Test: `apps/raven/web/src/components/FixMatchDialog/FixMatchDialog.test.tsx`, `apps/raven/web/src/pages/ShowPage/ShowPage.test.tsx`, `apps/raven/web/src/components/SuggestedMovies/SuggestedMovies.test.tsx`, `apps/raven/web/src/components/UnmatchedShows/UnmatchedShows.test.tsx`

**Interfaces:**
- Consumes: `MatchSubject` and `api.searchMatches({ type, query, year, libraryId, subject })` from step 1.
- Produces: `FixMatchDialog`'s required prop `subject: MatchSubject`; `matchSearchQuery({ type, query, year, libraryId, subject })`; `queryKeys.matchSearch({ type, query, year, libraryId, subject })`.

- [ ] **Step 1: Write the failing tests**

`FixMatchDialog.test.tsx`, in `it('searches with the parsed title and year, and points the file at the choice', ...)`: the `searched` array's type gains `subject?: MatchSubject | null`, the spy records `subject: request.subject`, and the expectation becomes:

```ts
    expect(searched).toEqual([
      {
        query: 'Busboys',
        year: 2026,
        libraryId: unmatched.libraryId,
        subject: { kind: 'media', id: unmatched.id },
      },
    ])
```

Import `type MatchSubject` from `@raven/core`.

In `it('searches again with what the viewer types', ...)`, record the subject the same way and add, after its last expectation, that every search kept the file:

```ts
    expect(searched.every((each) => each.subject?.kind === 'media' && each.subject.id === unmatched.id)).toBe(true)
```

(Read that test first; if its spy records into a differently named array, use that name.)

`ShowPage.test.tsx`, in `it('re-points the whole show from Fix match', ...)`, the last expectation gains `subject: { kind: 'item', id: 4 }`:

```ts
    expect(spies.search.mock.calls[0]?.[0]).toMatchObject({
      type: 'show',
      query: 'Severance',
      libraryId: EPISODE_TWO.libraryId,
      subject: { kind: 'item', id: 4 },
    })
```

`SuggestedMovies.test.tsx`, in `it("opens Fix match on the file's title, and hands focus back after", ...)`, after the title assertion:

```ts
    await waitFor(() =>
      expect(spies.search.mock.calls[0]?.[0]).toMatchObject({
        subject: { kind: 'media', id: FILES[2]?.id },
      }),
    )
```

Import `waitFor` from `@testing-library/react` if the file does not yet.

`UnmatchedShows.test.tsx`: the module mock records its searches. Above the mock:

```ts
const searched: Array<{ subject?: unknown }> = []
```

and the mock's `searchMatches` becomes:

```ts
    searchMatches: async (request: { subject?: unknown }) => {
      searched.push(request)
      return []
    },
```

In `it('opens Fix match for the show, pointing its first file at the choice', ...)`, after the title assertion:

```ts
    await waitFor(() => expect(searched.at(-1)).toMatchObject({ subject: { kind: 'media', id: 1 } }))
```

- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/web:test -- src/components/FixMatchDialog src/pages/ShowPage src/components/SuggestedMovies src/components/UnmatchedShows`
Expected: FAIL, each on the missing `subject`.

- [ ] **Step 3: Thread the subject through**

`apps/raven/web/src/lib/queryClient.ts`: `matchSearch` takes `subject: MatchSubject | null` and keys on it:

```ts
  matchSearch: ({
    type,
    query,
    year,
    libraryId,
    subject,
  }: {
    type: MatchItemType
    query: string
    year: number | null
    libraryId: number | null
    subject: MatchSubject | null
  }) => ['match', type, query, year, libraryId, subject?.kind ?? null, subject?.id ?? null],
```

`apps/raven/web/src/lib/queries.ts`: `matchSearchQuery` takes the same `subject: MatchSubject | null`, passes it to the key and to `api.searchMatches({ type, query, year, libraryId, subject })`. Update its doc comment: "A search for Fix match, scored against `subject` and best first; an empty title asks for nothing."

`FixMatchDialog.tsx`: a required prop, documented:

```ts
  /** The file (and its show folder) or the show being fixed: the results are scored against what it has on disk. */
  subject: MatchSubject
```

and the query: `matchSearchQuery({ type, query: asked.query, year: asked.year, libraryId: libraryId ?? null, subject })`.

The callers:
- `MediaMenu.tsx`: `subject={{ kind: 'media', id: media.id }}`.
- `SuggestedMovies.tsx`: `subject={{ kind: 'media', id: file.id }}`.
- `UnmatchedShows.tsx`: `subject={{ kind: 'media', id: first.id }}`.
- `ShowPage.tsx`: `subject={{ kind: 'item', id: details.id }}`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `bunx nx run @raven/web:test -- src/components/FixMatchDialog src/pages/ShowPage src/components/SuggestedMovies src/components/UnmatchedShows`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, format, commit**

Run: `bunx nx run @raven/web:typecheck`, `bunx nx run @raven/web:lint:ts`, `bunx nx run @raven/web:format`

```bash
git add apps/raven/web/src
git commit -F - <<'EOF'
MAE: raven's Fix match searches for the file or show it was opened on

- `FixMatchDialog` takes a `subject` and its search is keyed and scored by it
- the file menu, suggested movies and not matched shows name the file; the show page names the show
EOF
```

---

### Task 2: The stamp, the tier line and Best match

**Files:**
- Modify: `apps/raven/web/src/styles/globals.scss` (three color tokens)
- Modify: `apps/raven/web/src/components/Icon/Icon.tsx` (a `check` icon)
- Modify: `apps/raven/web/src/components/FixMatchDialog/FixMatchDialog.tsx` (`Candidate`)
- Modify: `apps/raven/web/src/components/FixMatchDialog/FixMatchDialog.module.scss`
- Test: `apps/raven/web/src/components/FixMatchDialog/FixMatchDialog.test.tsx`

**Interfaces:**
- Consumes: `confidenceTierOf`, `ConfidenceTier` from `@raven/core`; Task 1's `subject`.
- Produces: `--color-fern`, `--color-amber`, `--color-moss-line`; `IconName` `'check'`.

- [ ] **Step 1: Write the failing tests**

Add to `describe('Fix match', ...)` in `FixMatchDialog.test.tsx` (the `Harness`, `spies` and `unmatched` already there):

```ts
  const candidate = ({
    tmdbId,
    year,
    confidence,
    poster = null,
  }: {
    tmdbId: string
    year: number
    confidence: number
    poster?: string | null
  }) => ({ tmdbId, title: 'Busboys', year, overview: null, poster, confidence })

  const openWith = async (candidates: ReturnType<typeof candidate>[]) => {
    spies.search.mockImplementation(async () => candidates)
    renderWithProviders(<Harness media={unmatched} onMatched={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Options for Busboys (2026)' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fix match' }))
    await screen.findByRole('button', { name: `Choose Busboys (${candidates[0]?.year})` })
    return within(screen.getByRole('region', { name: 'Results' })).getAllByRole('listitem')
  }

  it('stamps each result with its confidence and names its tier, the Strong top one the best match', async () => {
    const rows = await openWith([
      candidate({ tmdbId: '1', year: 2026, confidence: 94, poster: '/b.jpg' }),
      candidate({ tmdbId: '2', year: 2016, confidence: 82 }),
      candidate({ tmdbId: '3', year: 1998, confidence: 71 }),
      candidate({ tmdbId: '4', year: 1990, confidence: 38 }),
    ])
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Best match'),
      expect.stringContaining('Strong match'),
      expect.stringContaining('Possible match'),
      expect.stringContaining('Weak match'),
    ])
    expect(rows.map((row) => within(row).getByText(/^\d+$/).textContent)).toEqual(['94', '82', '71', '38'])
    expect(screen.getAllByText('Best match')).toHaveLength(1)
  })

  it('names no best match when the top result is not Strong', async () => {
    await openWith([
      candidate({ tmdbId: '1', year: 2026, confidence: 79 }),
      candidate({ tmdbId: '2', year: 2016, confidence: 79 }),
    ])
    expect(screen.queryByText('Best match')).toBeNull()
    expect(screen.getAllByText('Possible match')).toHaveLength(2)
  })

  it('describes each Choose by its confidence, so a screen reader hears it with the title', async () => {
    await openWith([
      candidate({ tmdbId: '1', year: 2026, confidence: 94 }),
      candidate({ tmdbId: '2', year: 1998, confidence: 38 }),
    ])
    expect(screen.getByRole('button', { name: 'Choose Busboys (2026)' })).toHaveAccessibleDescription(
      /Best match.*confidence 94 out of 100/,
    )
    expect(screen.getByRole('button', { name: 'Choose Busboys (1998)' })).toHaveAccessibleDescription(
      /Weak match.*confidence 38 out of 100/,
    )
  })
```

Import `within` from `@testing-library/react`. The results section is labelled by its hidden "Results" heading, so `getByRole('region', { name: 'Results' })` finds it (a `section` with an accessible name is a region). The stamp is `aria-hidden`, which `getByText` still finds; only `*ByRole` queries skip it.

- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/web:test -- src/components/FixMatchDialog/FixMatchDialog.test.tsx`
Expected: FAIL, no "Best match" text and no description on Choose.

- [ ] **Step 3: Add the tokens**

In `apps/raven/web/src/styles/globals.scss`, after `--color-leaf-bright`:

```scss
  // How sure Fix match is of a result, and nothing else, so the red leaves
  // keep their two jobs: fern for a Strong match (9.2:1 on --color-night),
  // amber for a Possible one (8.7:1). As a fill they carry night text.
  --color-fern: #8fcf9f;
  --color-amber: #e3b45f;
  // A quiet edge that still clears 3:1 on --color-night: a Weak match's stamp.
  --color-moss-line: #5d736c;
```

- [ ] **Step 4: Add the check icon**

In `apps/raven/web/src/components/Icon/Icon.tsx`, add `| 'check'` to `IconName` (after `'close'`) and to `PATHS`:

```ts
  check: 'M5 12.5l4.5 4.5L19 7.5',
```

If a test or the `/design` page lists every icon by name, add `check` there too (search the web app for `'unlock'` to find such a list).

- [ ] **Step 5: Draw the candidate**

In `FixMatchDialog.tsx`, import `{ type ConfidenceTier, confidenceTierOf }` from `@raven/core` and `{ Icon }` from `@/components/Icon/Icon`, and add above `Candidate`:

```ts
const TIER_WORDS: Record<ConfidenceTier, string> = {
  strong: 'Strong match',
  possible: 'Possible match',
  weak: 'Weak match',
}
```

`Candidate` takes `isBest: boolean` and becomes:

```tsx
const Candidate = ({
  candidate,
  isBest,
  disabled,
  onChoose,
}: {
  candidate: MatchCandidate
  /** The first result, when it is Strong: named the best match. */
  isBest: boolean
  disabled: boolean
  onChoose: () => void
}) => {
  const tierId = useId()
  const poster = api.candidatePosterUrl(candidate.poster)
  const name = candidate.year == null ? candidate.title : `${candidate.title} (${candidate.year})`
  const tier = confidenceTierOf(candidate.confidence)
  return (
    <li className={isBest ? `${styles.candidate} ${styles.best}` : styles.candidate}>
      <span className={styles.poster}>
        {poster ? (
          <img src={poster} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className={styles.initial} aria-hidden="true">
            {candidate.title.slice(0, 1)}
          </span>
        )}
        <span className={`${styles.stamp} ${styles[tier]}`} aria-hidden="true">
          {tier === 'strong' && <Icon name="check" size={12} />}
          {candidate.confidence}
        </span>
      </span>
      <span className={styles.details}>
        <span className={styles.name}>{candidate.title}</span>
        {candidate.year != null && <span className={styles.year}>{candidate.year}</span>}
        <span id={tierId} className={`${styles.tier} ${styles[tier]}`}>
          {isBest && <Icon name="check" size={14} />}
          {isBest ? 'Best match' : TIER_WORDS[tier]}
          <span className="visually-hidden">, confidence {candidate.confidence} out of 100</span>
        </span>
        {candidate.overview != null && (
          <span className={styles.overview}>{candidate.overview}</span>
        )}
      </span>
      <Button
        className={styles.choose}
        disabled={disabled}
        onClick={onChoose}
        aria-label={`Choose ${name}`}
        aria-describedby={tierId}
      >
        Choose
      </Button>
    </li>
  )
}
```

The list passes `isBest`: the map gains its index,

```tsx
              {results.data.map((candidate, index) => (
                <Candidate
                  key={candidate.tmdbId}
                  candidate={candidate}
                  isBest={index === 0 && confidenceTierOf(candidate.confidence) === 'strong'}
                  disabled={choose.isPending}
                  onChoose={() => choose.mutate(candidate.tmdbId)}
                />
              ))}
```

Update the component's doc comment: "Fix match: searches TMDB with the title and year a name gave, scored against what the subject has on disk and listed best first, and points a file (or a whole show) at the result the viewer chooses, or at nothing."

- [ ] **Step 6: Style it**

In `FixMatchDialog.module.scss`:

`.candidate` gains named areas (keep its other declarations):

```scss
.candidate {
  display: grid;
  grid-template-columns: 3.5rem minmax(0, 1fr) auto;
  grid-template-areas: 'poster details choose';
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1);
  border-radius: var(--radius-md);
  background: var(--color-night);
}

.best {
  box-shadow: inset 0 0 0 1px var(--color-fern);
}
```

`.poster` stacks its picture (or initial) and the stamp in one named area:

```scss
.poster {
  grid-area: poster;
  display: grid;
  grid-template-areas: 'stack';
  aspect-ratio: 2 / 3;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: var(--color-moss);
  color: var(--color-lichen);
  font-family: var(--font-display);

  img {
    grid-area: stack;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.initial {
  grid-area: stack;
  place-self: center;
}

.stamp {
  grid-area: stack;
  align-self: end;
  display: grid;
  grid-auto-flow: column;
  justify-content: center;
  align-items: center;
  gap: 2px;
  padding-block: 1px;
  color: var(--color-night);
  font-family: var(--font-body);
  font-size: var(--font-size-xs);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: var(--line-body);

  &.strong {
    background: var(--color-fern);
  }

  &.possible {
    background: var(--color-amber);
  }

  &.weak {
    border-top: 1px solid var(--color-moss-line);
    background: var(--color-night);
    color: var(--color-lichen);
  }
}

.details {
  grid-area: details;
  display: grid;
  gap: 2px;
}

.tier {
  display: grid;
  grid-auto-flow: column;
  justify-content: start;
  align-items: center;
  gap: var(--space-0);
  font-size: var(--font-size-xs);
  font-weight: 600;

  &.strong {
    color: var(--color-fern);
  }

  &.possible {
    color: var(--color-amber);
  }

  &.weak {
    color: var(--color-lichen);
    font-weight: 400;
  }
}

.choose {
  grid-area: choose;
}

@media (max-width: 30rem) {
  .candidate {
    grid-template-columns: 3.5rem minmax(0, 1fr);
    grid-template-areas:
      'poster details'
      'choose choose';
  }
}

@media (forced-colors: active) {
  .stamp {
    border: 1px solid canvastext;
  }
}
```

Replace the existing `.poster` and `.details` blocks with these rather than adding second ones (`no-duplicate-selectors`). A `.choose` rule is new: `Button` already received `styles.choose`, which had no rule.

- [ ] **Step 7: Run the tests to see them pass**

Run: `bunx nx run @raven/web:test -- src/components/FixMatchDialog/FixMatchDialog.test.tsx`
Expected: PASS, the three new tests and every older one.

- [ ] **Step 8: Run the whole web suite and the checks**

Run: `bunx nx run @raven/web:test`, `bunx nx run @raven/web:typecheck`, `bunx nx run @raven/web:lint:ts`, `bunx nx run @raven/web:lint:css`
Expected: PASS. An older test that read a row's whole text (`textContent`) may now see the tier words in it; update it to read the part it meant.

- [ ] **Step 9: Look at it**

Run the web app against a dev server (`bunx nx run @raven/web:dev` with `@raven/server:dev`, or the `run` skill), open a library's Not matched tab, and open Fix match on a show folder. Check by eye, at full width and at 320px (the browser's responsive mode):
- the stamp across the bottom of each poster, the number legible, the check on Strong;
- the tier line under the year, the fern outline only on a Strong top row;
- at 320px, Choose under the row and nothing cut off.

If no dev server is to hand, render `FixMatchDialog` in a test with each tier and read the markup instead, and say so in the PR's Testing section.

- [ ] **Step 10: Format and commit**

Run: `bunx nx run @raven/web:format`

```bash
git add apps/raven/web/src
git commit -F - <<'EOF'
MAE: raven stamps each Fix match result with how sure it is

- a band across the poster holds the confidence: fern for Strong, amber for Possible, night for Weak
- the tier is named under the year, and a Strong top result is the Best match, outlined in fern
- Choose is described by the confidence for screen readers; Choose moves under the row below `30rem`
- `--color-fern`, `--color-amber` and `--color-moss-line`, and a `check` icon
EOF
```

---

## After the tasks

- `bun run verify` from the repo root, then push and open the PR with the `pr-format` skill: title `MAE: raven stamps each Fix match result with how sure it is`, base `raven-match-confidence-server`, with screenshots of the dialog (full width and 320px) as the skill describes.
