import {
  HOME_SHELF_TYPES,
  type HomeShelf,
  KEYS,
  type Library,
  type MediaItem,
  type Rating,
  type RatingSource,
  type ShowEntry,
  type UpcomingSearch,
  type UpcomingTitle,
  cardLink,
  cardTitle,
  formatAirDate,
  inSourceOrder,
  pickScore,
  requestKeyOf,
  showPath,
  withLibraries,
  isRecord,
} from '@raven/core'
import { Icon, PictureChips, classNames } from '@raven/ui'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { matchPath, useLocation, useNavigate } from 'react-router-dom'
import { Dotted } from '@/components/ItemHeader/ItemHeader'
import { ItemPoster, PosterImage, TmdbPoster } from '@/components/PosterImage/PosterImage'
import { RatingBadge } from '@/components/RatingPanel/RatingPanel'
import { SearchField } from '@/components/SearchField/SearchField'
import { SITE_SEARCH_COPY } from '@/components/SiteSearch/copy'
import { APP_PATHS, comingSoonTitlePath } from '@/lib/appPaths'
import { POSTER_SIZES } from '@/lib/posters'
import { homeSearchQuery, librariesQuery, upcomingSearchQuery } from '@/lib/queries'
import { COMING_SOON_COPY } from '@/pages/ComingSoonPage/copy'
import { useAddressSearch } from '@/lib/useSearch'
import styles from '@/components/SiteSearch/SiteSearch.module.scss'
import { handled } from '@/lib/handled'

/** How many letters, spaces aside, the box waits for before it suggests. */
const SUGGEST_AFTER_LETTERS = 3

/** How many titles the list offers; the last row opens every result. */
const MAX_SUGGESTIONS = 8

/** The query the suggestions are for: the settled text once it has enough letters, else none. */
const suggestionQueryOf = (query: string): string =>
  query.replace(/\s+/g, '').length >= SUGGEST_AFTER_LETTERS ? query : ''

/** One title the list offers: where it opens, its name, its line of facts, its poster and what its row ends with. */
type Suggestion = {
  key: string
  to: string
  state?: unknown
  title: string
  facts: ReactNode[]
  poster: ReactNode
  aside: ReactNode
}

/** How many scores a row ends with. */
const SHOWN_SCORES = 2

type LeadScoresProps = { ratings: readonly Rating[]; source: RatingSource }

/** A title's first scores: its library's chosen source's, else TMDB's, then the rest in a ratings panel's order. */
const leadScores = ({ ratings, source }: LeadScoresProps): Rating[] => {
  const lead = pickScore({ ratings, source })
  return [lead, ...inSourceOrder(ratings).filter((rating) => rating !== lead)]
    .filter((rating): rating is Rating => rating != null)
    .slice(0, SHOWN_SCORES)
}

type SuggestionAsideProps = LeadScoresProps & { media: MediaItem | null }

/** The end of a library title's row: its file's resolution, range and codec chips, then two of its scores. */
const SuggestionAside = ({ media, ratings, source }: SuggestionAsideProps) => (
  <span className={styles.aside}>
    {media && <PictureChips media={media} />}
    {leadScores({ ratings, source }).map((rating) => (
      <RatingBadge key={rating.source} rating={rating} />
    ))}
  </span>
)

type MediaSuggestionProps = { media: MediaItem; library: Library }

const mediaSuggestion = ({ media, library }: MediaSuggestionProps): Suggestion => {
  const { title, date } = cardTitle(media)
  const link = cardLink({ media, hasPages: true })
  return {
    key: `media:${media.id}`,
    to: link.to,
    state: link.state,
    title,
    facts: [date, library.name],
    poster: <PosterImage media={media} sizes={POSTER_SIZES.list} />,
    aside: (
      <SuggestionAside
        media={media}
        ratings={media.item?.ratings ?? []}
        source={library.settings.ratingsSource}
      />
    ),
  }
}

type ShowSuggestionProps = { entry: ShowEntry; library: Library }

const showSuggestion = ({ entry, library }: ShowSuggestionProps): Suggestion => ({
  key: `show:${entry.show.id}`,
  to: showPath(entry.show.id),
  title: entry.show.title,
  facts: [entry.show.year == null ? null : String(entry.show.year), library.name],
  poster: <ItemPoster item={entry.show} sizes={POSTER_SIZES.list} />,
  aside: (
    <SuggestionAside
      media={null}
      ratings={entry.show.ratings}
      source={library.settings.ratingsSource}
    />
  ),
})

type ShelfSuggestionsProps = { shelf: HomeShelf; library: Library }

/** A library's matches as suggestions: its shows, or its videos. */
const shelfSuggestions = ({ shelf, library }: ShelfSuggestionsProps): Suggestion[] => {
  switch (shelf.type) {
    case HOME_SHELF_TYPES.media:
      return shelf.media.map((media) => mediaSuggestion({ media, library }))
    case HOME_SHELF_TYPES.shows:
      return shelf.shows.map((entry) => showSuggestion({ entry, library }))
    default: {
      const unknown: never = shelf
      return unknown
    }
  }
}

type SuggestionsOfProps = { shelves: readonly HomeShelf[]; libraries: readonly Library[] }

/** The first titles the search found, in the side menu's library order. */
const suggestionsOf = ({ shelves, libraries }: SuggestionsOfProps): Suggestion[] =>
  withLibraries({ shelves, libraries })
    .flatMap((found) => shelfSuggestions(found))
    .slice(0, MAX_SUGGESTIONS)

/** An upcoming title as a suggestion: it opens the title's Coming soon page. */
const upcomingSuggestion = (title: UpcomingTitle): Suggestion => ({
  key: `upcoming:${requestKeyOf(title)}`,
  to: comingSoonTitlePath(title),
  title: title.title,
  facts: [formatAirDate(title.released), COMING_SOON_COPY.kinds[title.type]],
  poster: (
    <TmdbPoster poster={title.poster} sizes={POSTER_SIZES.list} className={styles.upcomingPoster} />
  ),
  aside: null,
})

const upcomingSuggestionsOf = (found: UpcomingSearch | undefined): Suggestion[] =>
  (found?.titles ?? []).slice(0, MAX_SUGGESTIONS).map(upcomingSuggestion)

/**
 * What the box searches: every library, or, on Coming soon's pages, the
 * movies and shows still to come that no library holds.
 */
const SEARCH_SCOPES = { libraries: 'libraries', upcoming: 'upcoming' } as const

type SearchScope = (typeof SEARCH_SCOPES)[keyof typeof SEARCH_SCOPES]

type ScopePlan = {
  placeholder: string
  /** What the list says while the first answer is on its way. */
  searching: string
  /**
   * Whether home shows every result: then the list ends with the row that
   * opens it and Enter with no pick does too. An upcoming search has no such
   * page, so Enter opens the pick, else the first title.
   */
  hasResultsPage: boolean
}

const SCOPE_PLANS = {
  [SEARCH_SCOPES.libraries]: {
    placeholder: SITE_SEARCH_COPY.searchEveryLibrary,
    searching: SITE_SEARCH_COPY.searching,
    hasResultsPage: true,
  },
  [SEARCH_SCOPES.upcoming]: {
    placeholder: SITE_SEARCH_COPY.searchUpcoming,
    searching: SITE_SEARCH_COPY.searchingUpcoming,
    hasResultsPage: false,
  },
} as const satisfies Record<SearchScope, ScopePlan>

type ScopeSuggestions = { found: Suggestion[]; isPending: boolean }

type UseScopeSuggestionsProps = { scope: SearchScope; asked: string }

/**
 * The titles the scope's search offers for `asked`. Every scope's queries
 * run on every page, the others asked for nothing, so the hooks keep their
 * order as the scope changes.
 */
const useScopeSuggestions = ({ scope, asked }: UseScopeSuggestionsProps): ScopeSuggestions => {
  const askedIn = (inScope: SearchScope) => (inScope === scope ? asked : '')
  const results = useQuery(homeSearchQuery(askedIn(SEARCH_SCOPES.libraries)))
  const libraries =
    useQuery({ ...librariesQuery, enabled: askedIn(SEARCH_SCOPES.libraries) !== '' }).data ?? []
  const upcoming = useQuery(upcomingSearchQuery(askedIn(SEARCH_SCOPES.upcoming)))
  const byScope = {
    [SEARCH_SCOPES.libraries]: {
      found: suggestionsOf({ shelves: results.data ?? [], libraries }),
      isPending: results.isPending,
    },
    [SEARCH_SCOPES.upcoming]: {
      found: upcomingSuggestionsOf(upcoming.data),
      isPending: upcoming.isPending,
    },
  } as const satisfies Record<SearchScope, ScopeSuggestions>
  return byScope[scope]
}

const scopeOf = (pathname: string): SearchScope =>
  matchPath({ path: APP_PATHS.comingSoon, end: false }, pathname) === null
    ? SEARCH_SCOPES.libraries
    : SEARCH_SCOPES.upcoming

/** A row of the list: a title it found, or the last row, which opens every result. */
const ROW_KINDS = { title: 'title', all: 'all' } as const

type Row = { kind: typeof ROW_KINDS.title; suggestion: Suggestion } | { kind: typeof ROW_KINDS.all }

type TitleRowProps = { suggestion: Suggestion }

const TitleRow = ({ suggestion }: TitleRowProps) => (
  <>
    <span className={styles.poster}>{suggestion.poster}</span>
    <span className={styles.words}>
      <span className={styles.title}>{suggestion.title}</span>
      <span className={styles.facts}>
        <Dotted parts={suggestion.facts.filter((fact) => fact != null)} />
      </span>
    </span>
    {suggestion.aside}
  </>
)

type AllRowProps = { query: string }

const AllRow = ({ query }: AllRowProps) => (
  <span className={styles.all}>{SITE_SEARCH_COPY.seeAll(query)}</span>
)

type RowViewProps = {
  [ROW_KINDS.title]: TitleRowProps
  [ROW_KINDS.all]: AllRowProps
}

const ROW_VIEWS = {
  [ROW_KINDS.title]: TitleRow,
  [ROW_KINDS.all]: AllRow,
} as const satisfies ViewsOf<RowViewProps>

type RowViewOfProps = { row: Row; query: string }

const rowViewOf = ({ row, query }: RowViewOfProps): ViewOf<RowViewProps> => {
  if (row.kind === ROW_KINDS.title) return { key: ROW_KINDS.title, props: row }
  return { key: ROW_KINDS.all, props: { query } }
}

type NoteOfProps = { isPending: boolean; count: number; searching: string }

/** What the list says under its rows while it has no title to offer. */
const noteOf = ({ isPending, count, searching }: NoteOfProps): string | null => {
  if (count > 0) return null
  return isPending ? searching : SITE_SEARCH_COPY.nothingYet
}

/** Where the arrows move the pick: down from nothing to the first row, up from nothing to the last. */
type StepProps = { from: number | null; step: 1 | -1; count: number }

const stepped = ({ from, step, count }: StepProps): number => {
  const start = from ?? (step === 1 ? -1 : count)
  return (start + step + count) % count
}

const ARROW_STEPS = { [KEYS.arrowDown]: 1, [KEYS.arrowUp]: -1 } as const satisfies Record<
  string,
  1 | -1
>

const isArrow = (key: string): key is keyof typeof ARROW_STEPS => key in ARROW_STEPS

/** What a link hands Home in its state to open with the cursor in the search. */
export const SEARCH_ASK = { isSearchAsked: true } as const

/** Whether a page's state asks for the search, as `SEARCH_ASK` does. */
const asksForSearch = (state: unknown): boolean => isRecord(state) && !!state.isSearchAsked

type SiteSearchProps = { className?: string }

/**
 * The search at the top of every page: through every library, or on Coming
 * soon's pages through what is still to come and no library holds, each
 * suggestion opening its Coming soon page. Once three
 * letters are typed and the typing pauses, a list under the box offers the
 * first titles found, each opening its page, and a last row that opens home
 * on every result, as Enter does. Its results are home's: on home the search
 * rides in the address as `?q=`, and anywhere else Enter opens home on it.
 * Over a pale backdrop the box has nothing to stand on, so focus brings up
 * dark glass under it.
 */
export const SiteSearch = ({ className }: SiteSearchProps) => {
  const id = useId()
  const listId = useId()
  const navigate = useNavigate()
  const { pathname, state } = useLocation()
  const input = useRef<HTMLInputElement>(null)
  // A way in that asks for the search, as a phone's More sheet's Search, puts the cursor in it.
  useEffect(() => {
    if (asksForSearch(state)) input.current?.focus()
  }, [state])
  const scope = scopeOf(pathname)
  const plan = SCOPE_PLANS[scope]
  const search = useAddressSearch({ page: '/', shouldWaitForEnter: true })
  const asked = suggestionQueryOf(search.query)
  const { found, isPending } = useScopeSuggestions({ scope, asked })
  const [isFocused, setFocused] = useState(false)
  // The text the list was dismissed on: Escape, Enter or a pick hide it until the text changes.
  const [dismissed, setDismissed] = useState<{ text: string } | null>(null)
  // Adjusting state during render is React's way to derive this from the previous render.
  if (dismissed !== null && dismissed.text !== search.text) setDismissed(null)
  // The pick, kept only for the query it was made on.
  const [pick, setPick] = useState<{ asked: string; index: number } | null>(null)
  const rows: Row[] = [
    ...found.map((suggestion) => ({ kind: ROW_KINDS.title, suggestion }) as const),
    ...(plan.hasResultsPage ? [{ kind: ROW_KINDS.all } as const] : []),
  ]
  const isShown = isFocused && asked !== '' && dismissed === null
  const picked = pick != null && pick.asked === asked ? pick.index : null
  const note = noteOf({ isPending, count: found.length, searching: plan.searching })

  const dismiss = () => {
    setDismissed({ text: search.text })
    setPick(null)
  }

  const open = (row: Row) => {
    dismiss()
    if (row.kind === ROW_KINDS.all) {
      search.searchNow()
      return
    }
    handled(Promise.resolve(navigate(row.suggestion.to, { state: row.suggestion.state })))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // With no page of results, Enter opens the pick, else the first title.
    if (!plan.hasResultsPage && event.key === KEYS.enter) {
      event.preventDefault()
      const row = isShown ? rows[picked ?? 0] : undefined
      if (row) open(row)
      return
    }
    if (!isShown) return
    if (event.key === KEYS.escape) {
      event.preventDefault()
      dismiss()
      return
    }
    if (isArrow(event.key)) {
      event.preventDefault()
      if (rows.length === 0) return
      setPick({
        asked,
        index: stepped({ from: picked, step: ARROW_STEPS[event.key], count: rows.length }),
      })
      return
    }
    if (event.key !== KEYS.enter) return
    const row = picked === null ? null : rows[picked]
    // Enter on no pick is the field's own: it opens home on the search.
    if (!row) {
      dismiss()
      return
    }
    event.preventDefault()
    open(row)
  }

  return (
    <search
      className={classNames([styles.search, className])}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
      }}
    >
      <label htmlFor={id} className="visually-hidden">
        {plan.placeholder}
      </label>
      <SearchField
        ref={input}
        id={id}
        search={search}
        className={styles.input}
        placeholder={plan.placeholder}
        autoComplete="off"
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- it is an input; a searchbox may not carry aria-expanded, a combobox may
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={isShown}
        aria-activedescendant={picked === null ? undefined : `${listId}-${picked}`}
        onKeyDown={onKeyDown}
      />
      <span className={styles.icon}>
        <Icon name="search" size={20} />
      </span>
      {isShown && (
        <ul
          id={listId}
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role -- a combobox's list of rich options (a poster and facts each), which no datalist or select draws
          role="listbox"
          aria-label={SITE_SEARCH_COPY.suggestions}
          className={styles.suggestions}
        >
          {note != null && <li className={styles.note}>{note}</li>}
          {rows.map((row, index) => (
            // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- the box's keys reach these options, as a combobox's do
            <li
              key={row.kind === ROW_KINDS.title ? row.suggestion.key : ROW_KINDS.all}
              id={`${listId}-${index}`}
              // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role -- an option element could not hold a poster and its facts
              role="option"
              aria-selected={picked === index}
              className={classNames([
                styles.option,
                row.kind === ROW_KINDS.all && styles.optionAll,
              ])}
              // The box keeps the focus, so the list stays up through the click.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => open(row)}
            >
              <KeyedView<RowViewProps> views={ROW_VIEWS} view={rowViewOf({ row, query: asked })} />
            </li>
          ))}
        </ul>
      )}
    </search>
  )
}
