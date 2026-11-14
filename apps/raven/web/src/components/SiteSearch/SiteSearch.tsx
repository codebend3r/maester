import {
  HOME_SHELF_TYPES,
  type HomeShelf,
  KEYS,
  type Library,
  type MediaItem,
  type ShowEntry,
  cardLink,
  cardTitle,
  showPath,
  withLibraries,
} from '@raven/core'
import { Icon } from '@raven/ui'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { type KeyboardEvent, type ReactNode, useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dotted } from '@/components/ItemHeader/ItemHeader'
import { ItemPoster, PosterImage } from '@/components/PosterImage/PosterImage'
import { SearchField } from '@/components/SearchField/SearchField'
import { SITE_SEARCH_COPY } from '@/components/SiteSearch/copy'
import { POSTER_SIZES } from '@/lib/posters'
import { homeSearchQuery, librariesQuery } from '@/lib/queries'
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

/** One title the list offers: where it opens, its name, its line of facts and its poster. */
type Suggestion = {
  key: string
  to: string
  state?: unknown
  title: string
  facts: ReactNode[]
  poster: ReactNode
}

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
  }
}

type ShowSuggestionProps = { entry: ShowEntry; library: Library }

const showSuggestion = ({ entry, library }: ShowSuggestionProps): Suggestion => ({
  key: `show:${entry.show.id}`,
  to: showPath(entry.show.id),
  title: entry.show.title,
  facts: [entry.show.year == null ? null : String(entry.show.year), library.name],
  poster: <ItemPoster item={entry.show} sizes={POSTER_SIZES.list} />,
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

type NoteOfProps = { isPending: boolean; count: number }

/** What the list says under its rows while it has no title to offer. */
const noteOf = ({ isPending, count }: NoteOfProps): string | null => {
  if (count > 0) return null
  return isPending ? SITE_SEARCH_COPY.searching : SITE_SEARCH_COPY.nothingYet
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

type SiteSearchProps = { className?: string }

/**
 * The search through every library at the top of every page. Once three
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
  const search = useAddressSearch({ page: '/', shouldWaitForEnter: true })
  const asked = suggestionQueryOf(search.query)
  const results = useQuery(homeSearchQuery(asked))
  const libraries = useQuery({ ...librariesQuery, enabled: asked !== '' }).data ?? []
  const [isFocused, setFocused] = useState(false)
  // The text the list was dismissed on: Escape, Enter or a pick hide it until the text changes.
  const [dismissed, setDismissed] = useState<{ text: string } | null>(null)
  // Adjusting state during render is React's way to derive this from the previous render.
  if (dismissed !== null && dismissed.text !== search.text) setDismissed(null)
  // The pick, kept only for the query it was made on.
  const [pick, setPick] = useState<{ asked: string; index: number } | null>(null)
  const found = suggestionsOf({ shelves: results.data ?? [], libraries })
  const rows: Row[] = [
    ...found.map((suggestion) => ({ kind: ROW_KINDS.title, suggestion }) as const),
    { kind: ROW_KINDS.all },
  ]
  const isShown = isFocused && asked !== '' && dismissed === null
  const picked = pick != null && pick.asked === asked ? pick.index : null
  const note = noteOf({ isPending: results.isPending, count: found.length })

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
    if (!isShown) return
    if (event.key === KEYS.escape) {
      event.preventDefault()
      dismiss()
      return
    }
    if (isArrow(event.key)) {
      event.preventDefault()
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
      className={[styles.search, className].filter(Boolean).join(' ')}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
      }}
    >
      <label htmlFor={id} className="visually-hidden">
        {SITE_SEARCH_COPY.searchEveryLibrary}
      </label>
      <SearchField
        id={id}
        search={search}
        className={styles.input}
        placeholder={SITE_SEARCH_COPY.searchEveryLibrary}
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
              className={[styles.option, row.kind === ROW_KINDS.all ? styles.optionAll : '']
                .filter(Boolean)
                .join(' ')}
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
