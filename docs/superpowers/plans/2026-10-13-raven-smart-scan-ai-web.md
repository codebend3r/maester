# raven smart scan, step 5: the AI lookup, web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web app shows what the AI lookup did. Edit library hints at the key while it is unset. The Not matched tab offers each unsure pick as a card with its poster, "Suggested: Title (Year)", the reason, Accept and Fix match. Item pages and the Fix match dialog say "Matched by AI" with the reason.

**Architecture:**
- `AiSuggestionCard` is one suggestion. Accept calls the function it is given, which is always the Fix match call (`api.setMatch`), then refetches as Fix match does.
- In a TV library's Not matched tab, `UnmatchedShows` puts the card inside the show folder's entry. In a movie library's, `SuggestedMovies` lists the cards above the files, one per folder and suggestion.
- `AiMatchNote` is the "Matched by AI" line. The movie page, the show page and `FixMatchDialog` show it whenever `ItemDetails.aiMatch` is set.
- `LibraryDialog` reads `MetadataHealth.ai === 'off'` for the key hint.

**Tech Stack:** React 19, TanStack Query, SCSS modules, bun test with happy-dom and Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-12-raven-smart-scan-design.md`, section 4 ("Web"), "Order of work" step 5 and the web part of "Testing". It builds on step 4 (`2026-10-13-raven-smart-scan-ai-server.md`).

## Global Constraints

- Every rule in the root `CLAUDE.md` holds:
  - no `any`, no casts, and no non-null assertions outside tests;
  - `type`, never `interface`, and no enums;
  - named exports only;
  - no `for`, `for...of` or `for...in` loops;
  - one object parameter wherever there are two or more;
  - `@/` imports with no extension, SCSS modules included;
  - `&&` in JSX, never a ternary with a `null` branch;
  - no em or en dashes anywhere, UI copy included.
- CSS:
  - component styles are SCSS modules;
  - layout is grid with `gap` and padding, never flex and never margins;
  - fixed regions are placed with named `grid-template-areas`;
  - colors, fonts, sizes, line heights, spacing and radii come from `apps/raven/web/src/styles/globals.scss` (`--color-*`, `--font-*`, `--font-size-*`, `--line-*`, `--space-*`, `--radius-*`, `--focus-ring`);
  - responsive styles are desktop-first, at the thresholds already in use (`30rem`, `48rem`), and every view works at 320px wide;
  - no new animation or transition (a later one goes inside `@media (prefers-reduced-motion: no-preference)`).
- Accessibility: semantic elements, a label on every control, and a visible `:focus-visible` (the `Button` component brings its own).
- The copy, binding from the spec:
  - the hint: "Set `ANTHROPIC_API_KEY` in raven's `.env` to look up titles the matcher misses.", after the `TMDB_API_TOKEN` hint;
  - the card: "Suggested: Archie: The Man Who Became Cary Grant (2023)", with Accept and Fix match;
  - the note: "Matched by AI." followed by the reason.
- Accepting a suggestion is the existing Fix match call: `api.setMatch({ mediaId, tmdbId })` for the group's first file, which writes a user override.
- From step 4, consumed as they are: `AiSuggestion`, `AiMatch`, `UnmatchedFile`, `MetadataHealth.ai` and `aiRemaining`, `ItemDetails.aiMatch`, `api.listUnmatched` answering `UnmatchedFile[]`, and the web fixtures `unmatchedFile` and `itemDetails` (with `aiMatch: null`). From step 3: `FixMatchDialog`'s `libraryId` prop.
- Run tasks through Nx from the repo root: `bunx nx run @raven/web:test`, one file with `-- <path>` (as in `bunx nx run @raven/web:test -- src/components/AiSuggestionCard/AiSuggestionCard.test.tsx`), `bunx nx run @raven/web:typecheck`, `bunx nx run @raven/web:lint:ts`, `bunx nx run @raven/web:lint:css`, and `bun run verify` before the PR.
- Commits follow the `commit-format` skill: a `MAE:` subject, a short bullet body written with a heredoc, and no agent attribution. That skill forbids naming the assistant's vendor anywhere in a commit, so subjects and bodies say "the AI lookup", never the vendor, the model or the assistant.
- Branch `raven-smart-scan-ai-web` from `raven-smart-scan-ai-server` once step 4's final fix wave is committed. The PR is stacked on step 4's PR.
- `bunx nx run @raven/web:format` (oxfmt, 100 columns, single quotes) before every commit.
- Work in flight: if the `@raven/ui` extraction (desktop step 3) has landed and moved `LibraryDialog`, `FixMatchDialog` or `SectionViews`, rebase onto it and make these edits in their new homes, with the same code.

## Deviations from the spec, on purpose

- **A TV entry with a suggestion has no Fix match button of its own.** The card's Fix match takes its place and opens the same dialog, so each entry has one.
- **A movie library lists its suggestions in a "Suggested by AI" section above the files**, one card per folder and suggestion: a movie kept in two qualities is one card. The files stay listed below, each with its menu's Fix match.
- **The hint shows whenever the key is unset**, TMDB set or not, for every type, as the TMDB hint does, after it.
- **The All tab's Not matched group in a TV library shows no card.** The shows listing carries no suggestion (step 4); the Not matched tab is where they are.
- **`useReturnFocus` is drawn out of `UnmatchedShows`** and shared with `SuggestedMovies`: both hand focus back to Fix match once its dialog closes.

## Amendments from the pre-flight scan

Each task reads these before its own steps; where one names a task, it binds that task's code.

- Step 4's final fixes, which this step relies on: a group with any Fix match at its place has no `aiSuggestion` (the server filters on read), and a type preference change keeps `high` decisions. So Accept, which writes a Fix match, makes the card go on the next read.
- Task 2:
  - `suggestedMoviesOf` accumulates with `found.concat({ key, file, suggestion: aiSuggestion })`, not a spread (oxlint `no-accumulating-spread`).
  - The movie card's key follows the server's grouping, which keeps a folder together only when it holds one movie: `` `folder:${file.folder}|${file.title}|${file.year}|${aiSuggestion.tmdbId}` `` for a folder key, `` `file:${file.id}` `` at a root. Two qualities of one movie still make one card.
  - A folder key's card is labelled by `file.folder` (the paragraph and Accept's `subject`), a file key's by `file.fileName`; update the two tests that name the file (the `SuggestedMovies` accept test and the movie tab test).
  - The TV focus test: after `const fix = ...`, add `expect(fix.closest('article')).not.toBeNull()` so it fails first and pins the card's own button. Step 9 says "the five older tests", not four.
  - The TV tab test pins that the card goes: before clicking Accept, `spies.unmatched.mockImplementation(async () => [])`; after the `setMatch` assertion, `await waitFor(() => expect(screen.queryByText('Suggested: Archie: The Man Who Became Cary Grant (2023)')).toBeNull())`.
  - The card's `.error` copies `FixMatchDialog.module.scss`'s `.error` (`padding: var(--space-2) var(--space-3); border-left: 2px solid var(--color-leaf-bright); background: var(--color-night);`, text in the inherited colour), for AA contrast.
  - The TV entry's `.suggestion` gets `max-width: var(--measure);`.
- Task 3: the note also shows in Fix match opened from a card's menu. While `fixing`, `MediaMenu`'s `MenuBody` reads `itemQuery(media.item?.id ?? null)` and passes `aiMatch={item.data?.aiMatch ?? null}` to `FixMatchDialog`; a file with no item, or an episode (whose details carry no `aiMatch`), shows none. Add a test: Fix match from a card of a movie whose details carry `aiMatch` shows the note. Seasons and episodes never carry one (step 4).
- Deviations, add: the All tab's Not matched group, in a TV or a movie library, shows no card, as those listings carry no suggestion (step 4).
- Task 4:
  - Screenshots (the `pr-format` skill and its `screenshots.md`): the suggestion and note states need staged decisions. On the demo server (`TMDB_API_TOKEN` set, no AI key), add a Movies and a TV library, each with one clip TMDB finds nothing for (`Demo Reel (2031)/Demo Reel (2031).mp4`, `Demo Show/Season 1/Demo Show - S01E01.mp4`). With `sqlite3 <DATA_DIR>/raven.db`, insert into `ai_decisions` one `low` row per library at the group's place (the movie's folder; the show folder) naming an open movie such as Sintel (`tmdb_id`, `title`, `year`, `poster`, `reason`, `model`, `decided_at`), and one `high` row at an already matched clip's folder with that clip's own `tmdb_id`. Reload, then capture the dialog hint, a TV entry's card, the movie suggestions, the movie page's note, and Fix match with the note.
  - The PR title and body never write the vendor's name, the variable included: describe Task 1 as "the hint names the AI lookup's key".

## Review Focus

1. **Accept is the Fix match call for the group's first file**, so a TV accept re-points the whole folder and is kept as a user override; the listing is fetched again and the card goes. Pinned in Task 2 (`UnmatchedShows`, `SuggestedMovies`, the Not matched tab).
2. **A failed Accept says why and leaves the card**, and Accept cannot be sent twice while it runs. Pinned in Task 2 (`AiSuggestionCard`).
3. **Each TV entry has one Fix match, and focus comes back to it** after its dialog closes, whether or not there is a suggestion. Pinned in Task 2.
4. **The note shows only where `aiMatch` is set**: not on a movie a search or Fix match matched, and in the Fix match dialog too. Pinned in Task 3.
5. **The type hint reads in order**: TMDB's sentence, then the AI key's, only while that key is unset. Pinned in Task 1, with the existing TMDB test.

---

## Files

| File | Change |
| --- | --- |
| `apps/raven/web/src/components/LibraryDialog/LibraryDialog.tsx`, `.test.tsx` | the key hint |
| `apps/raven/web/src/test/fixtures.ts` | `aiSuggestion` |
| `apps/raven/web/src/lib/useReturnFocus.ts` (new) | focus back to Fix match once its dialog closes |
| `apps/raven/web/src/components/AiSuggestionCard/` (new) | `AiSuggestionCard.tsx`, `.module.scss`, `.test.tsx` |
| `apps/raven/web/src/components/UnmatchedShows/UnmatchedShows.tsx`, `.module.scss`, `.test.tsx` | `suggestionOf`, the card in an entry |
| `apps/raven/web/src/components/SuggestedMovies/` (new) | `SuggestedMovies.tsx`, `.module.scss`, `.test.tsx` |
| `apps/raven/web/src/pages/LibraryPage/SectionViews.tsx` | the Not matched tab passes suggestions on |
| `apps/raven/web/src/pages/LibraryPage/LibraryTabs.test.tsx` | accepting on the tab, TV and movies |
| `apps/raven/web/src/components/AiMatchNote/` (new) | `AiMatchNote.tsx`, `.module.scss` |
| `apps/raven/web/src/components/PlayableItemView/PlayableItemView.tsx` | the note on a movie's page; `aiMatch` to its menu |
| `apps/raven/web/src/components/MediaMenu/MediaMenu.tsx` | `aiMatch` prop on to Fix match |
| `apps/raven/web/src/components/FixMatchDialog/FixMatchDialog.tsx`, `.test.tsx` | the note in the dialog |
| `apps/raven/web/src/pages/ShowPage/ShowPage.tsx`, `.test.tsx` | the note on a show's page and in its Fix match |
| `apps/raven/web/src/pages/MoviePage/MoviePage.test.tsx` | the note on a movie's page |

---

### Task 1: Edit library hints at the AI key

**Files:**
- Modify: `apps/raven/web/src/components/LibraryDialog/LibraryDialog.tsx` (the Type fieldset, near line 149)
- Modify: `apps/raven/web/src/components/LibraryDialog/LibraryDialog.test.tsx`

**Interfaces:**
- Consumes: `MetadataHealth.ai` (step 4), `metadataHealthQuery`.
- Produces: nothing other tasks use.

- [ ] **Step 1: Make the test's health answer settable, and write the failing tests**

In `LibraryDialog.test.tsx`, add `type MetadataHealth` to the `@raven/core` import, and above `mock.module(...)`:

```ts
/** What the next dialog finds of metadata: TMDB off and the AI key set, unless a test says otherwise. */
const NO_TMDB: MetadataHealth = {
  tmdb: 'off',
  omdb: 'off',
  pending: 0,
  error: null,
  lastOk: null,
  ai: 'ok',
  aiRemaining: 200,
}
const metadataHealth: { now: MetadataHealth } = { now: NO_TMDB }
```

In the mocked `api`, replace the `getMetadataHealth` entry with:

```ts
    getMetadataHealth: async () => metadataHealth.now,
```

After `'says how to turn on posters and details while TMDB is off'` (which keeps passing, as the AI key is set there), add:

```ts
  it("says how to turn the AI lookup on while its key is unset, after TMDB's hint", async () => {
    metadataHealth.now = { ...NO_TMDB, ai: 'off', aiRemaining: 0 }
    try {
      renderWithProviders(<LibraryDialog onClose={() => undefined} />)
      const type = screen.getByRole('group', { name: 'Type' })
      expect(await screen.findByText('ANTHROPIC_API_KEY')).toBeInTheDocument()
      expect(type).toHaveAccessibleDescription(
        "Set TMDB_API_TOKEN in raven's .env for posters and details. Set ANTHROPIC_API_KEY in raven's .env to look up titles the matcher misses.",
      )
    } finally {
      metadataHealth.now = NO_TMDB
    }
  })

  it('names only the AI key once TMDB is set', async () => {
    metadataHealth.now = { ...NO_TMDB, tmdb: 'ok', ai: 'off', aiRemaining: 0 }
    try {
      renderWithProviders(<LibraryDialog onClose={() => undefined} />)
      const type = screen.getByRole('group', { name: 'Type' })
      expect(await screen.findByText('ANTHROPIC_API_KEY')).toBeInTheDocument()
      expect(type).toHaveAccessibleDescription(
        "Movies, TV shows, anime, family and documentaries get posters and details from TMDB. Set ANTHROPIC_API_KEY in raven's .env to look up titles the matcher misses.",
      )
    } finally {
      metadataHealth.now = NO_TMDB
    }
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bunx nx run @raven/web:test -- src/components/LibraryDialog/LibraryDialog.test.tsx`
Expected: the two new tests FAIL, `Unable to find an element with the text: ANTHROPIC_API_KEY`; the rest PASS.

- [ ] **Step 3: Add the hint**

In `LibraryDialog.tsx`, after `const metadata = useQuery(metadataHealthQuery)`:

```ts
  // `off` is exactly "no key": a key that fails is the health check's to report.
  const isAiOff = metadata.data?.ai === 'off'
```

Change the Type fieldset's opening tag to:

```tsx
        <fieldset
          className={styles.field}
          aria-describedby={isAiOff ? `${ids.kind}-hint ${ids.kind}-ai-hint` : `${ids.kind}-hint`}
        >
```

and after the TMDB hint's closing `</p>`, inside the fieldset:

```tsx
          {isAiOff && (
            <p id={`${ids.kind}-ai-hint`} className={styles.hint}>
              Set <code>ANTHROPIC_API_KEY</code> in raven's <code>.env</code> to look up titles
              the matcher misses.
            </p>
          )}
```

The fieldset is already a one-column grid with a gap, so the second hint sits under the first with no new style.

- [ ] **Step 4: Run them to verify they pass**

Run: `bunx nx run @raven/web:test -- src/components/LibraryDialog/LibraryDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/raven/web/src/components/LibraryDialog/LibraryDialog.tsx apps/raven/web/src/components/LibraryDialog/LibraryDialog.test.tsx
git commit -m "$(cat <<'EOF'
MAE: raven's Edit library says how to turn the AI lookup on

- While its key is unset, the Type hint names it after the TMDB hint
- Screen readers hear both hints, in that order
EOF
)"
```

---

### Task 2: The Not matched tab offers each suggestion

**Files:**
- Modify: `apps/raven/web/src/test/fixtures.ts`
- Create: `apps/raven/web/src/lib/useReturnFocus.ts`
- Create: `apps/raven/web/src/components/AiSuggestionCard/AiSuggestionCard.tsx`, `AiSuggestionCard.module.scss`, `AiSuggestionCard.test.tsx`
- Modify: `apps/raven/web/src/components/UnmatchedShows/UnmatchedShows.tsx`, `UnmatchedShows.module.scss`, `UnmatchedShows.test.tsx`
- Create: `apps/raven/web/src/components/SuggestedMovies/SuggestedMovies.tsx`, `SuggestedMovies.module.scss`, `SuggestedMovies.test.tsx`
- Modify: `apps/raven/web/src/pages/LibraryPage/SectionViews.tsx` (`NotMatchedSection`, near line 273)
- Modify: `apps/raven/web/src/pages/LibraryPage/LibraryTabs.test.tsx`

**Interfaces:**
- Consumes: `AiSuggestion`, `UnmatchedFile` (step 4); `unmatchedFile` fixture (step 4); `api.setMatch`, `api.candidatePosterUrl`, `afterMatch`; `FixMatchDialog` with `libraryId` (step 3).
- Produces:
  - `aiSuggestion(overrides?: Partial<AiSuggestion>): AiSuggestion` (fixture)
  - `useReturnFocus({ isOpen, target }: { isOpen: boolean; target: RefObject<HTMLElement | null> }): void`
  - `suggestedName(suggestion: AiSuggestion): string`; `AiSuggestionCard({ suggestion, subject, accept, onFix, fixRef })`
  - `UnmatchedShows`'s optional `suggestionOf?: (file: MediaItem) => AiSuggestion | null`
  - `suggestedMoviesOf(files: readonly UnmatchedFile[]): SuggestedMovie[]`, `SuggestedMovies({ files, libraryId })`

- [ ] **Step 1: Add the fixture**

In `apps/raven/web/src/test/fixtures.ts`, add `AiSuggestion` to its `import type { ... } from '@raven/core'` list (a `type` modifier inside that list does not compile), and after `unmatchedFile`:

```ts
/** What the AI lookup suggests for a group it was not sure of. */
export const aiSuggestion = (overrides: Partial<AiSuggestion> = {}): AiSuggestion => ({
  tmdbId: '201000',
  title: 'Archie: The Man Who Became Cary Grant',
  year: 2023,
  poster: '/archie.jpg',
  reason: 'The only Archie series from 2023; its episode titles are generic.',
  ...overrides,
})
```

- [ ] **Step 2: Write the failing card tests**

Create `apps/raven/web/src/components/AiSuggestionCard/AiSuggestionCard.test.tsx`:

```tsx
import { describe, expect, it } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AiSuggestion } from '@raven/core'
import { AiSuggestionCard } from '@/components/AiSuggestionCard/AiSuggestionCard'
import { api } from '@/lib/api'
import { aiSuggestion } from '@/test/fixtures'
import { held } from '@/test/held'
import { renderWithProviders } from '@/test/render'

const ACCEPT = 'Accept Archie: The Man Who Became Cary Grant (2023) for Archie'

const card = ({
  accept = async () => undefined,
  onFix = () => undefined,
  suggestion = aiSuggestion(),
}: {
  accept?: (tmdbId: string) => Promise<unknown>
  onFix?: () => void
  suggestion?: AiSuggestion
} = {}) =>
  renderWithProviders(
    <AiSuggestionCard suggestion={suggestion} subject="Archie" accept={accept} onFix={onFix} />,
  )

describe('AiSuggestionCard', () => {
  it("shows the poster, what it suggests, and why", () => {
    const { container } = card()
    expect(
      screen.getByRole('article', {
        name: 'Suggested: Archie: The Man Who Became Cary Grant (2023)',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('The only Archie series from 2023; its episode titles are generic.'),
    ).toBeInTheDocument()
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      api.candidatePosterUrl('/archie.jpg'),
    )
  })

  it('names a suggestion with no year by its title, and stands its first letter in for no poster', () => {
    const { container } = card({ suggestion: aiSuggestion({ year: null, poster: null }) })
    expect(
      screen.getByRole('article', { name: 'Suggested: Archie: The Man Who Became Cary Grant' }),
    ).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('accepts once with the id it suggests, holding Accept while that runs', async () => {
    const pending = held<undefined>()
    const accepted: string[] = []
    card({
      accept: (tmdbId) => {
        accepted.push(tmdbId)
        return pending.promise
      },
    })
    const accept = screen.getByRole('button', { name: ACCEPT })
    await userEvent.click(accept)
    expect(accept).toBeDisabled()
    await userEvent.click(accept)
    expect(accepted).toEqual(['201000'])
    pending.answer(undefined)
    await waitFor(() => expect(accept).toBeEnabled())
  })

  it('says why Accept failed, and stays', async () => {
    card({ accept: async () => Promise.reject(new Error('TMDB has no show with that id.')) })
    await userEvent.click(screen.getByRole('button', { name: ACCEPT }))
    expect(await screen.findByRole('alert')).toHaveTextContent('TMDB has no show with that id.')
    expect(screen.getByRole('button', { name: ACCEPT })).toBeEnabled()
  })

  it('opens Fix match', async () => {
    const opened: string[] = []
    card({ onFix: () => opened.push('fix') })
    await userEvent.click(screen.getByRole('button', { name: 'Fix match for Archie' }))
    expect(opened).toEqual(['fix'])
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `bunx nx run @raven/web:test -- src/components/AiSuggestionCard/AiSuggestionCard.test.tsx`
Expected: FAIL, `Cannot find module '@/components/AiSuggestionCard/AiSuggestionCard'`.

- [ ] **Step 4: Write the focus hook and the card**

Create `apps/raven/web/src/lib/useReturnFocus.ts`:

```ts
import { type RefObject, useEffect, useRef } from 'react'

/**
 * Hands focus back to `target` once the modal it opened has closed. The open
 * dialog makes everything behind it inert, so focus can only come back once
 * it has unmounted.
 */
export const useReturnFocus = ({
  isOpen,
  target,
}: {
  isOpen: boolean
  target: RefObject<HTMLElement | null>
}): void => {
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !isOpen) target.current?.focus()
    wasOpen.current = isOpen
  }, [isOpen, target])
}
```

Create `apps/raven/web/src/components/AiSuggestionCard/AiSuggestionCard.tsx`:

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { AiSuggestion } from '@raven/core'
import { type Ref, useId } from 'react'
import { Button } from '@/components/Button/Button'
import { api } from '@/lib/api'
import { afterMatch } from '@/lib/invalidate'
import styles from '@/components/AiSuggestionCard/AiSuggestionCard.module.scss'

/** A suggestion's title as a person reads it, with its year when TMDB gives one. */
export const suggestedName = (suggestion: AiSuggestion): string =>
  suggestion.year == null ? suggestion.title : `${suggestion.title} (${suggestion.year})`

/**
 * What the AI lookup suggests for files it was not sure of: the poster, the
 * title and year, and the reason it gave. Accept points the files at it with
 * the call Fix match makes, so it is kept as a Fix match; Fix match opens
 * the search to choose another.
 */
export const AiSuggestionCard = ({
  suggestion,
  subject,
  accept,
  onFix,
  fixRef,
}: {
  suggestion: AiSuggestion
  /** What the suggestion is for, named in the buttons' labels: the show folder, or the file. */
  subject: string
  /** Points the files at `tmdbId`, as Fix match does. */
  accept: (tmdbId: string) => Promise<unknown>
  onFix: () => void
  /** The Fix match button, for focus to come back to once its dialog closes. */
  fixRef?: Ref<HTMLButtonElement>
}) => {
  const titleId = useId()
  const queryClient = useQueryClient()
  const accepting = useMutation({
    mutationFn: () => accept(suggestion.tmdbId),
    onSuccess: () => afterMatch(queryClient),
  })
  const poster = api.candidatePosterUrl(suggestion.poster)
  const name = suggestedName(suggestion)
  return (
    <article className={styles.card} aria-labelledby={titleId}>
      <span className={styles.poster}>
        {poster ? (
          <img src={poster} alt="" loading="lazy" decoding="async" />
        ) : (
          <span aria-hidden="true">{suggestion.title.slice(0, 1)}</span>
        )}
      </span>
      <div className={styles.text}>
        <p id={titleId} className={styles.title}>
          Suggested: {name}
        </p>
        <p className={styles.reason}>{suggestion.reason}</p>
        {accepting.isError && (
          <p role="alert" className={styles.error}>
            {accepting.error.message}
          </p>
        )}
      </div>
      <footer className={styles.actions}>
        <Button
          tone="primary"
          disabled={accepting.isPending}
          aria-label={`Accept ${name} for ${subject}`}
          onClick={() => accepting.mutate()}
        >
          Accept
        </Button>
        <Button ref={fixRef} icon="search" aria-label={`Fix match for ${subject}`} onClick={onFix}>
          Fix match
        </Button>
      </footer>
    </article>
  )
}
```

Create `apps/raven/web/src/components/AiSuggestionCard/AiSuggestionCard.module.scss`:

```scss
.card {
  display: grid;
  grid-template-columns: 4rem minmax(0, 1fr);
  grid-template-areas:
    'poster text'
    'poster actions';
  align-items: start;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--color-moss);
  border-radius: var(--radius-md);
  background: var(--color-canopy);
}

.poster {
  grid-area: poster;
  display: grid;
  place-items: center;
  aspect-ratio: 2 / 3;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: var(--color-moss);
  color: var(--color-lichen);
  font-family: var(--font-display);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.text {
  grid-area: text;
  display: grid;
  gap: var(--space-0);
  min-width: 0;
}

.title {
  font-family: var(--font-display);
  font-size: var(--font-size-md);
  line-height: var(--line-tight);
  overflow-wrap: break-word;
}

.reason {
  color: var(--color-lichen);
  font-size: var(--font-size-sm);
  line-height: var(--line-body);
}

.error {
  color: var(--color-leaf-bright);
  font-size: var(--font-size-sm);
}

.actions {
  grid-area: actions;
  display: grid;
  grid-auto-flow: column;
  justify-content: start;
  gap: var(--space-1);
}

@media (max-width: 30rem) {
  .card {
    grid-template-columns: 3rem minmax(0, 1fr);
    grid-template-areas:
      'poster text'
      'actions actions';
  }
}
```

- [ ] **Step 5: Run them to verify they pass**

Run: `bunx nx run @raven/web:test -- src/components/AiSuggestionCard/AiSuggestionCard.test.tsx`
Expected: PASS.

- [ ] **Step 6: Write the failing TV entry tests**

In `UnmatchedShows.test.tsx`, add `aiSuggestion` to the `@/test/fixtures` import, and append inside `describe('UnmatchedShows', ...)`:

```tsx
  it("shows what the AI lookup suggests in the show's entry, with Accept and its one Fix match", async () => {
    renderWithProviders(
      <UnmatchedShows
        files={files}
        renderFiles={() => null}
        suggestionOf={(file) => (file.id === 1 ? aiSuggestion() : null)}
      />,
    )
    const [archie] = screen.getAllByRole('listitem')
    expect(
      within(archie!).getByRole('article', {
        name: 'Suggested: Archie: The Man Who Became Cary Grant (2023)',
      }),
    ).toBeInTheDocument()
    expect(within(archie!).getAllByRole('button', { name: 'Fix match for Archie' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Fix match for Veronica' })).toBeInTheDocument()
    await userEvent.click(
      within(archie!).getByRole('button', {
        name: 'Accept Archie: The Man Who Became Cary Grant (2023) for Archie',
      }),
    )
    expect(matched.at(-1)).toEqual({ mediaId: 1, tmdbId: '201000' })
  })

  it("hands focus back to the suggestion's Fix match once its dialog is cancelled", async () => {
    renderWithProviders(
      <UnmatchedShows files={files} renderFiles={() => null} suggestionOf={() => aiSuggestion()} />,
    )
    const fix = screen.getByRole('button', { name: 'Fix match for Archie' })
    await userEvent.click(fix)
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fix).toHaveFocus()
  })
```

- [ ] **Step 7: Run them to verify they fail**

Run: `bunx nx run @raven/web:test -- src/components/UnmatchedShows/UnmatchedShows.test.tsx`
Expected: the new tests FAIL (TypeScript in the test runner ignores the unknown prop; no article is found).

- [ ] **Step 8: Put the card in a show's entry**

Replace `apps/raven/web/src/components/UnmatchedShows/UnmatchedShows.tsx` with:

```tsx
import { type AiSuggestion, type MediaItem, type UnmatchedShow, unmatchedShowsOf } from '@raven/core'
import { type ReactNode, useId, useRef, useState } from 'react'
import { AiSuggestionCard } from '@/components/AiSuggestionCard/AiSuggestionCard'
import { Button } from '@/components/Button/Button'
import { FixMatchDialog } from '@/components/FixMatchDialog/FixMatchDialog'
import { Icon } from '@/components/Icon/Icon'
import { api } from '@/lib/api'
import { plural } from '@/lib/plural'
import { useReturnFocus } from '@/lib/useReturnFocus'
import styles from '@/components/UnmatchedShows/UnmatchedShows.module.scss'

/**
 * One show folder: a toggle to its episodes, and Fix match, which points the
 * whole folder at a show. When the AI lookup suggested a show, its card
 * holds Accept and the folder's Fix match.
 */
const UnmatchedShowEntry = ({
  group,
  renderFiles,
  suggestionOf,
}: {
  group: UnmatchedShow
  renderFiles: (files: MediaItem[]) => ReactNode
  suggestionOf: (file: MediaItem) => AiSuggestion | null
}) => {
  const regionId = useId()
  const fixButton = useRef<HTMLButtonElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isFixing, setIsFixing] = useState(false)
  const first = group.files[0]
  const suggestion = first == null ? null : suggestionOf(first)
  useReturnFocus({ isOpen: isFixing, target: fixButton })

  return (
    <li className={styles.show}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={isOpen}
        aria-controls={regionId}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className={styles.chevron} aria-hidden="true">
          <Icon name="next" size={18} />
        </span>
        <span className={styles.title}>{group.title}</span>
        <span className={styles.count}>
          {plural({ n: group.files.length, one: 'episode', many: 'episodes' })}
        </span>
      </button>
      {!suggestion && (
        <Button
          ref={fixButton}
          className={styles.fix}
          icon="search"
          aria-label={`Fix match for ${group.title}`}
          onClick={() => setIsFixing(true)}
        >
          Fix match
        </Button>
      )}
      {suggestion && first && (
        <div className={styles.suggestion}>
          <AiSuggestionCard
            suggestion={suggestion}
            subject={group.title}
            accept={(tmdbId) => api.setMatch({ mediaId: first.id, tmdbId })}
            onFix={() => setIsFixing(true)}
            fixRef={fixButton}
          />
        </div>
      )}
      <section id={regionId} aria-label={group.title} className={styles.files} hidden={!isOpen}>
        {isOpen && renderFiles(group.files)}
      </section>
      {isFixing && first && (
        <FixMatchDialog
          type="show"
          title={group.title}
          year={null}
          libraryId={first.libraryId}
          match={(tmdbId) => api.setMatch({ mediaId: first.id, tmdbId })}
          onClose={() => setIsFixing(false)}
        />
      )}
    </li>
  )
}

/** A listing the AI lookup has nothing for. */
const NO_SUGGESTION = (): AiSuggestion | null => null

/**
 * A TV library's unmatched files, one entry per show folder, each opening
 * in place to its episodes. Fix match on an entry re-points the whole
 * folder; a suggestion's Accept does the same with the show it names.
 */
export const UnmatchedShows = ({
  files,
  renderFiles,
  suggestionOf = NO_SUGGESTION,
}: {
  files: MediaItem[]
  renderFiles: (files: MediaItem[]) => ReactNode
  /** What the AI lookup suggests for a file's show folder; none unless given. */
  suggestionOf?: (file: MediaItem) => AiSuggestion | null
}) => (
  <ul className={styles.list}>
    {unmatchedShowsOf(files).map((group) => (
      <UnmatchedShowEntry
        key={group.key}
        group={group}
        renderFiles={renderFiles}
        suggestionOf={suggestionOf}
      />
    ))}
  </ul>
)
```

(Step 3 already passes `libraryId={first.libraryId}` to the dialog here; keep it.)

In `UnmatchedShows.module.scss`, change `.show`'s areas and the narrow layout's, and add `.suggestion`:

```scss
.show {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    'toggle fix'
    'suggestion suggestion'
    'files files';
  align-items: center;
  // The suggestion and the files region bring their own top padding, so an
  // entry without them adds no row gap.
  gap: 0 var(--space-2);
  border-bottom: 1px solid var(--color-moss);
  padding-bottom: var(--space-1);
}

.suggestion {
  grid-area: suggestion;
  padding: var(--space-1) 0 0;
}
```

and inside `@media (max-width: 30rem)`:

```scss
  .show {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'toggle'
      'fix'
      'suggestion'
      'files';
  }
```

- [ ] **Step 9: Run them to verify they pass**

Run: `bunx nx run @raven/web:test -- src/components/UnmatchedShows/UnmatchedShows.test.tsx`
Expected: PASS, the four older tests included (focus still comes back to the entry's own Fix match).

- [ ] **Step 10: Write the failing movie suggestion tests**

Create `apps/raven/web/src/components/SuggestedMovies/SuggestedMovies.test.tsx`:

```tsx
import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SuggestedMovies, suggestedMoviesOf } from '@/components/SuggestedMovies/SuggestedMovies'
import { api } from '@/lib/api'
import { aiSuggestion, unmatchedFile } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

const HEAT = aiSuggestion({ tmdbId: '949', title: 'Heat', year: 1995, poster: null })

const FILES = [
  unmatchedFile({
    id: 1,
    folder: 'Archie (2023)',
    fileName: 'Archie (2023) 1080p.mkv',
    title: 'Archie',
    year: 2023,
    aiSuggestion: aiSuggestion(),
  }),
  unmatchedFile({
    id: 2,
    folder: 'Archie (2023)',
    fileName: 'Archie (2023) 2160p.mkv',
    title: 'Archie',
    year: 2023,
    aiSuggestion: aiSuggestion(),
  }),
  unmatchedFile({ id: 3, folder: '', fileName: 'Heat.mkv', title: 'Heat', aiSuggestion: HEAT }),
  unmatchedFile({ id: 4, folder: '', fileName: 'Thief.mkv', title: 'Thief', aiSuggestion: HEAT }),
  unmatchedFile({ id: 5, folder: 'Odds', fileName: 'Unknown.mkv', title: 'Unknown' }),
]

describe('suggestedMoviesOf', () => {
  it('gives a folder one card a suggestion, so two qualities are one, and each loose file its own', () => {
    expect(
      suggestedMoviesOf(FILES).map((entry) => [entry.file.id, entry.suggestion.tmdbId]),
    ).toEqual([
      [1, '201000'],
      [3, '949'],
      [4, '949'],
    ])
  })
})

describe('SuggestedMovies', () => {
  const spies = { search: spyOn(api, 'searchMatches'), setMatch: spyOn(api, 'setMatch') }

  afterEach(() => {
    spies.search.mockReset()
    spies.setMatch.mockReset()
  })

  it('shows nothing when the lookup suggested nothing', () => {
    const { container } = renderWithProviders(
      <SuggestedMovies files={FILES.slice(4)} libraryId={2} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("accepts a suggestion for the file, pointing it as Fix match would", async () => {
    spies.setMatch.mockImplementation(async () => unmatchedFile({ id: 1, match: 'manual' }))
    renderWithProviders(<SuggestedMovies files={FILES} libraryId={2} />)
    expect(screen.getByRole('region', { name: 'Suggested by AI' })).toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(3)
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Accept Archie: The Man Who Became Cary Grant (2023) for Archie (2023) 1080p.mkv',
      }),
    )
    expect(spies.setMatch).toHaveBeenCalledWith({ mediaId: 1, tmdbId: '201000' })
  })

  it("opens Fix match on the file's title, and hands focus back after", async () => {
    spies.search.mockImplementation(async () => [])
    renderWithProviders(<SuggestedMovies files={FILES.slice(2, 3)} libraryId={2} />)
    const fix = screen.getByRole('button', { name: 'Fix match for Heat.mkv' })
    await userEvent.click(fix)
    expect(screen.getByRole('searchbox', { name: 'Title' })).toHaveValue('Heat')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fix).toHaveFocus()
  })
})
```

- [ ] **Step 11: Run them to verify they fail**

Run: `bunx nx run @raven/web:test -- src/components/SuggestedMovies/SuggestedMovies.test.tsx`
Expected: FAIL, `Cannot find module '@/components/SuggestedMovies/SuggestedMovies'`.

- [ ] **Step 12: Write the movie suggestions**

Create `apps/raven/web/src/components/SuggestedMovies/SuggestedMovies.tsx`:

```tsx
import type { AiSuggestion, MediaItem, UnmatchedFile } from '@raven/core'
import { useId, useRef, useState } from 'react'
import { AiSuggestionCard } from '@/components/AiSuggestionCard/AiSuggestionCard'
import { FixMatchDialog } from '@/components/FixMatchDialog/FixMatchDialog'
import { api } from '@/lib/api'
import { useReturnFocus } from '@/lib/useReturnFocus'
import styles from '@/components/SuggestedMovies/SuggestedMovies.module.scss'

/** One card: a file with a suggestion, standing for every file of its folder suggested the same. */
export type SuggestedMovie = { key: string; file: MediaItem; suggestion: AiSuggestion }

/**
 * The files the AI lookup suggested a movie for, one per folder and
 * suggestion, as a movie kept in two qualities is one; a file at the root of
 * the folder its titles sit in is its own.
 */
export const suggestedMoviesOf = (files: readonly UnmatchedFile[]): SuggestedMovie[] =>
  files.reduce<SuggestedMovie[]>((found, file) => {
    const { aiSuggestion } = file
    if (aiSuggestion == null) return found
    const key =
      file.folder === '' ? `file:${file.id}` : `folder:${file.folder}|${aiSuggestion.tmdbId}`
    return found.some((entry) => entry.key === key)
      ? found
      : [...found, { key, file, suggestion: aiSuggestion }]
  }, [])

/** One suggestion: the file it is for, its card, and Fix match on that file. */
const SuggestedMovieEntry = ({ entry, libraryId }: { entry: SuggestedMovie; libraryId: number }) => {
  const fixButton = useRef<HTMLButtonElement>(null)
  const [isFixing, setIsFixing] = useState(false)
  useReturnFocus({ isOpen: isFixing, target: fixButton })
  const { file } = entry
  const pointAt = (tmdbId: string | null) => api.setMatch({ mediaId: file.id, tmdbId })
  return (
    <li className={styles.entry}>
      <p className={styles.file}>{file.fileName}</p>
      <AiSuggestionCard
        suggestion={entry.suggestion}
        subject={file.fileName}
        accept={pointAt}
        onFix={() => setIsFixing(true)}
        fixRef={fixButton}
      />
      {isFixing && (
        <FixMatchDialog
          type="movie"
          title={file.title}
          year={file.year}
          fileName={file.fileName}
          libraryId={libraryId}
          match={pointAt}
          onClose={() => setIsFixing(false)}
        />
      )}
    </li>
  )
}

/**
 * The AI lookup's suggestions in a movie library's Not matched tab, above
 * its files; nothing when it has none.
 */
export const SuggestedMovies = ({
  files,
  libraryId,
}: {
  files: readonly UnmatchedFile[]
  libraryId: number
}) => {
  const headingId = useId()
  const suggested = suggestedMoviesOf(files)
  if (suggested.length === 0) return null
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        Suggested by AI
      </h2>
      <ul className={styles.list}>
        {suggested.map((entry) => (
          <SuggestedMovieEntry key={entry.key} entry={entry} libraryId={libraryId} />
        ))}
      </ul>
    </section>
  )
}
```

Create `apps/raven/web/src/components/SuggestedMovies/SuggestedMovies.module.scss`:

```scss
.section {
  display: grid;
  gap: var(--space-2);
}

.heading {
  font-family: var(--font-display);
  font-size: var(--font-size-lg);
  font-weight: 400;
  line-height: var(--line-tight);
}

// The cards are a collection, so they are placed by the grid, not by name.
.list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr));
  gap: var(--space-2);
}

.entry {
  display: grid;
  align-content: start;
  gap: var(--space-1);
}

.file {
  color: var(--color-lichen);
  font-size: var(--font-size-sm);
  overflow-wrap: anywhere;
}
```

- [ ] **Step 13: Run them to verify they pass**

Run: `bunx nx run @raven/web:test -- src/components/SuggestedMovies/SuggestedMovies.test.tsx`
Expected: PASS.

- [ ] **Step 14: Write the failing tab tests**

In `apps/raven/web/src/pages/LibraryPage/LibraryTabs.test.tsx`, add `setMatch: spyOn(api, 'setMatch'),` to `spies`, and `aiSuggestion` to the `@/test/fixtures` import. After `'groups the files not matched of a TV library by show folder'`, add:

```tsx
  it("offers the AI lookup's suggestion for a show folder, and accepts it as Fix match would", async () => {
    spies.unmatched.mockImplementation(async () =>
      [1, 2].map((id) =>
        unmatchedFile({
          id,
          title: `Archie - S01E0${id}`,
          folder: 'Archie/Season 1',
          fileName: `Archie - S01E0${id}.mkv`,
          aiSuggestion: aiSuggestion(),
        }),
      ),
    )
    spies.setMatch.mockImplementation(async () => mediaItem({ id: 1, match: 'manual' }))
    open({ kind: 'shows', route: '/libraries/2/not-matched' })
    expect(
      await screen.findByText('Suggested: Archie: The Man Who Became Cary Grant (2023)'),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Fix match for Archie' })).toHaveLength(1)
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Accept Archie: The Man Who Became Cary Grant (2023) for Archie',
      }),
    )
    expect(spies.setMatch).toHaveBeenCalledWith({ mediaId: 1, tmdbId: '201000' })
  })

  it("offers the AI lookup's suggestion for a movie above the files", async () => {
    spies.unmatched.mockImplementation(async () => [
      unmatchedFile({
        id: 9,
        title: 'Archie',
        year: 2023,
        folder: 'Archie (2023)',
        fileName: 'Archie (2023).mkv',
        aiSuggestion: aiSuggestion(),
      }),
    ])
    spies.setMatch.mockImplementation(async () => mediaItem({ id: 9, match: 'manual' }))
    open({ route: '/libraries/2/not-matched' })
    const suggested = await screen.findByRole('region', { name: 'Suggested by AI' })
    await userEvent.click(
      within(suggested).getByRole('button', {
        name: 'Accept Archie: The Man Who Became Cary Grant (2023) for Archie (2023).mkv',
      }),
    )
    expect(spies.setMatch).toHaveBeenCalledWith({ mediaId: 9, tmdbId: '201000' })
    expect(screen.getByRole('link', { name: /Archie/ })).toBeInTheDocument()
  })
```

- [ ] **Step 15: Run them to verify they fail**

Run: `bunx nx run @raven/web:test -- src/pages/LibraryPage/LibraryTabs.test.tsx`
Expected: the two new tests FAIL: no suggestion is shown on the tab yet.

- [ ] **Step 16: Pass the suggestions on in the tab**

In `apps/raven/web/src/pages/LibraryPage/SectionViews.tsx`:

Add `type AiSuggestion` and `type UnmatchedFile` to the `@raven/core` import, and `import { SuggestedMovies } from '@/components/SuggestedMovies/SuggestedMovies'`.

Above `NotMatchedSection`, add:

```ts
/** What the AI lookup suggests for a file, read off the Not matched listing. */
const suggestionsIn =
  (files: readonly UnmatchedFile[]) =>
  (file: MediaItem): AiSuggestion | null =>
    files.find((each) => each.id === file.id)?.aiSuggestion ?? null
```

In `NotMatchedSection`, change the listing to:

```tsx
          {matchType === 'show' ? (
            <UnmatchedShows
              files={files}
              suggestionOf={suggestionsIn(files)}
              renderFiles={(group) => (
                <MediaGrid
                  items={group}
                  matchType={matchType}
                  ratingsSource={library.settings.ratingsSource}
                />
              )}
            />
          ) : (
            <>
              <SuggestedMovies files={files} libraryId={library.id} />
              <MediaGrid
                items={files}
                matchType={matchType}
                ratingsSource={library.settings.ratingsSource}
              />
            </>
          )}
```

Change the section's comment to: `The files no movie or show was found for, each with Fix match in its menu, and what the AI lookup suggests where it was not sure. While TMDB answers, the tab keeps reading again until none is pending, then reads the library again for its count of files not matched.`

- [ ] **Step 17: Run the web tests and checks**

Run: `bunx nx run @raven/web:test` then `bunx nx run @raven/web:typecheck`, `bunx nx run @raven/web:lint:ts` and `bunx nx run @raven/web:lint:css`
Expected: PASS.

- [ ] **Step 18: Commit**

```bash
git add apps/raven/web/src/test/fixtures.ts apps/raven/web/src/lib/useReturnFocus.ts apps/raven/web/src/components/AiSuggestionCard apps/raven/web/src/components/UnmatchedShows apps/raven/web/src/components/SuggestedMovies apps/raven/web/src/pages/LibraryPage/SectionViews.tsx apps/raven/web/src/pages/LibraryPage/LibraryTabs.test.tsx
git commit -m "$(cat <<'EOF'
MAE: raven's Not matched tab offers what the AI lookup suggests

- A card with the poster, the title and year, the reason, Accept and Fix match
- In a TV library it sits in the show folder's entry; in a movie library, above the files, one per folder
- Accept is the Fix match call, so the choice is kept as one
EOF
)"
```

---

### Task 3: "Matched by AI" on item pages and in Fix match

**Files:**
- Create: `apps/raven/web/src/components/AiMatchNote/AiMatchNote.tsx`, `AiMatchNote.module.scss`
- Modify: `apps/raven/web/src/components/PlayableItemView/PlayableItemView.tsx`
- Modify: `apps/raven/web/src/components/MediaMenu/MediaMenu.tsx` (`MenuProps` near line 151, `MenuBody`, its `FixMatchDialog` near line 334)
- Modify: `apps/raven/web/src/components/FixMatchDialog/FixMatchDialog.tsx`, `FixMatchDialog.test.tsx`
- Modify: `apps/raven/web/src/pages/ShowPage/ShowPage.tsx`, `ShowPage.test.tsx`
- Modify: `apps/raven/web/src/pages/MoviePage/MoviePage.test.tsx`

**Interfaces:**
- Consumes: `AiMatch`, `ItemDetails.aiMatch` (step 4); the `itemDetails` fixture.
- Produces: `AiMatchNote({ aiMatch }: { aiMatch: AiMatch })`; `FixMatchDialog`'s and `MediaMenu`'s optional `aiMatch?: AiMatch | null`.

- [ ] **Step 1: Write the failing page and dialog tests**

In `apps/raven/web/src/pages/MoviePage/MoviePage.test.tsx`, append inside `describe('MoviePage', ...)`:

```tsx
  it('says the movie was matched by AI, and why', async () => {
    open({
      details: itemDetails({
        aiMatch: { reason: 'The title and year fit, and no other result does.' },
      }),
    })
    const note = await screen.findByText('Matched by AI.')
    expect(note.closest('p')).toHaveTextContent(
      'Matched by AI. The title and year fit, and no other result does.',
    )
  })

  it('says nothing of AI for a movie a search or Fix match matched', async () => {
    open({ details: itemDetails() })
    expect(await screen.findByRole('heading', { level: 1, name: 'Busboys' })).toBeInTheDocument()
    expect(screen.queryByText('Matched by AI.')).toBeNull()
  })
```

In `apps/raven/web/src/pages/ShowPage/ShowPage.test.tsx`, add `import type { ItemDetails } from '@raven/core'`, change `open` to take the details:

```tsx
  const open = ({ details = SEVERANCE }: { details?: ItemDetails } = {}) => {
    spies.item.mockImplementation(async () => details)
```

(the rest of `open` unchanged), and append:

```tsx
  it('says the show was matched by AI, and says so in Fix match too', async () => {
    const reason = "Season 1's episode titles match TMDB's."
    open({ details: { ...SEVERANCE, aiMatch: { reason } } })
    const note = await screen.findByText('Matched by AI.')
    expect(note.closest('p')).toHaveTextContent(`Matched by AI. ${reason}`)
    spies.search.mockImplementation(async () => [])
    await userEvent.click(screen.getByRole('button', { name: 'Fix match' }))
    expect(screen.getByRole('dialog')).toHaveTextContent(`Matched by AI. ${reason}`)
  })
```

In `apps/raven/web/src/components/FixMatchDialog/FixMatchDialog.test.tsx`, change its core import to `import type { AiMatch, MediaItem } from '@raven/core'`, give `Harness` an `aiMatch` prop passed to `MediaMenu`:

```tsx
const Harness = ({
  media,
  onMatched,
  aiMatch = null,
}: {
  media: MediaItem
  onMatched: (media: MediaItem) => void
  aiMatch?: AiMatch | null
}) => {
  const [open, setOpen] = useState(false)
  return (
    <MediaMenu
      media={media}
      open={open}
      onOpenChange={setOpen}
      matchType="movie"
      onMatched={onMatched}
      aiMatch={aiMatch}
    />
  )
}
```

and append inside `describe('Fix match', ...)`:

```tsx
  it('says the file was matched by AI, and why, above the search', async () => {
    spies.search.mockImplementation(async () => [])
    renderWithProviders(
      <Harness
        media={unmatched}
        onMatched={() => undefined}
        aiMatch={{ reason: 'The title and year fit.' }}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Options for Busboys (2026)' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fix match' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Matched by AI. The title and year fit.')
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bunx nx run @raven/web:test -- src/pages/MoviePage/MoviePage.test.tsx src/pages/ShowPage/ShowPage.test.tsx src/components/FixMatchDialog/FixMatchDialog.test.tsx`
Expected: the three "Matched by AI" tests FAIL, `Unable to find an element with the text: Matched by AI.`; the rest PASS.

- [ ] **Step 3: Write the note**

Create `apps/raven/web/src/components/AiMatchNote/AiMatchNote.tsx`:

```tsx
import type { AiMatch } from '@raven/core'
import { Icon } from '@/components/Icon/Icon'
import styles from '@/components/AiMatchNote/AiMatchNote.module.scss'

/** Says the AI lookup matched this movie or show, being sure, and why. Fix match still points it elsewhere. */
export const AiMatchNote = ({ aiMatch }: { aiMatch: AiMatch }) => (
  <p className={styles.note}>
    <Icon name="wand" size={16} />
    <span>
      <strong>Matched by AI.</strong> {aiMatch.reason}
    </span>
  </p>
)
```

Create `apps/raven/web/src/components/AiMatchNote/AiMatchNote.module.scss`:

```scss
.note {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: var(--space-1);
  max-width: var(--measure);
  color: var(--color-lichen);
  font-size: var(--font-size-sm);
  line-height: var(--line-body);

  strong {
    color: var(--color-bark);
    font-weight: 600;
  }
}
```

- [ ] **Step 4: Show it on the pages and in Fix match**

In `FixMatchDialog.tsx`, change the core import to `import type { AiMatch, MatchCandidate, MatchItemType } from '@raven/core'`, import `AiMatchNote` from `@/components/AiMatchNote/AiMatchNote`, add the prop after `fileName` in the destructuring (`aiMatch = null,`) and its type:

```ts
  /** Why the AI lookup matched what is being fixed, being sure; null or left out when it did not. */
  aiMatch?: AiMatch | null
```

and in the `<header>`, after the file name line:

```tsx
          {aiMatch && <AiMatchNote aiMatch={aiMatch} />}
```

In `MediaMenu.tsx`, add `type AiMatch` to its `@raven/core` import, add to `MenuProps` after `matchType`:

```ts
  /** Why the AI lookup matched the file's movie, shown in Fix match; null or left out when it did not. */
  aiMatch?: AiMatch | null
```

destructure `aiMatch = null,` in `MenuBody` after `matchType = null,`, and pass `aiMatch={aiMatch}` to its `FixMatchDialog`.

In `PlayableItemView.tsx`, import `AiMatchNote`, pass `aiMatch={details.aiMatch}` to `MediaMenu`, and after `<PlaybackNote media={primary} />`:

```tsx
      {details.aiMatch && <AiMatchNote aiMatch={details.aiMatch} />}
```

(An episode's details never carry one, so its page shows none.)

In `ShowPage.tsx`, import `AiMatchNote`; after `</ItemHeader>`:

```tsx
      {details.aiMatch && <AiMatchNote aiMatch={details.aiMatch} />}
```

and pass `aiMatch={details.aiMatch}` to its `FixMatchDialog`.

Both pages are grids with a gap, so the note takes its own row with no new style.

- [ ] **Step 5: Run them to verify they pass**

Run: `bunx nx run @raven/web:test -- src/pages/MoviePage/MoviePage.test.tsx src/pages/ShowPage/ShowPage.test.tsx src/components/FixMatchDialog/FixMatchDialog.test.tsx` then `bunx nx run @raven/web:test`, `bunx nx run @raven/web:typecheck`, `bunx nx run @raven/web:lint:ts` and `bunx nx run @raven/web:lint:css`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/raven/web/src/components/AiMatchNote apps/raven/web/src/components/PlayableItemView/PlayableItemView.tsx apps/raven/web/src/components/MediaMenu/MediaMenu.tsx apps/raven/web/src/components/FixMatchDialog/FixMatchDialog.tsx apps/raven/web/src/components/FixMatchDialog/FixMatchDialog.test.tsx apps/raven/web/src/pages/ShowPage/ShowPage.tsx apps/raven/web/src/pages/ShowPage/ShowPage.test.tsx apps/raven/web/src/pages/MoviePage/MoviePage.test.tsx
git commit -m "$(cat <<'EOF'
MAE: raven's pages say when the AI lookup matched a title, and why

- A movie's and a show's page carry a "Matched by AI." note with the reason
- Fix match shows the same note above its search
EOF
)"
```

---

### Task 4: Verify and open the PR

**Files:** none new.

- [ ] **Step 1: Run every check**

Run: `bun run verify`
Expected: every project passes spellcheck, lint, format, typecheck, tests and build. Fix what fails in the task it belongs to, with its own commit.

- [ ] **Step 2: Read the diff for what the linters miss**

Run: `git diff raven-smart-scan-ai-server --stat`, then read the whole diff once for:
- an em or en dash (`grep -nP '[\x{2013}\x{2014}]'` over the changed files finds none);
- a flex layout, a margin, or a literal where a token exists;
- a positional second parameter, a cast, or a ternary with a `null` branch in JSX;
- the 320px width: the card's narrow layout is `3rem` beside the text with the buttons under both, the movie cards' column is `min(100%, 22rem)`, and a TV entry stacks at `30rem`.

- [ ] **Step 3: Push and open the PR**

Push `raven-smart-scan-ai-web` and open the PR with base `raven-smart-scan-ai-server`, following the `pr-format` skill: a `MAE:` title, `Stacked on #<step 4 PR>.` first, then What, Why and Testing by Nx project, with screenshots of the dialog hint, a TV entry's card, the movie suggestions and the note (the skill keeps them under `refs/screenshots`). Its no-attribution rule applies: "the AI lookup" in the title and body.
