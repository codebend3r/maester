import { useSearch } from '@raven/ui/headless'
import {
  FILTER_CHIPS,
  RECENT_KINDS,
  SEARCH_COPY,
  SEARCH_FILTERS,
  type SearchFilter,
} from '@raven/wren'
import { type ComponentType, useState } from 'react'
import type { ResultsProps } from '@/screens/Search/ResultParts'
import { SearchIdle } from '@/screens/Search/SearchIdle'
import { SearchResults } from '@/screens/Search/SearchResults'
import { useResultActions } from '@/screens/Search/useResultActions'
import { useSearchResults } from '@/screens/Search/useSearchResults'
import { Page } from '@/shell/Page/Page'
import { useRecentSearches } from '@/stores/recentSearches'
import { FilterChips } from '@/ui/FilterChips/FilterChips'
import { PageHeader } from '@/ui/PageHeader/PageHeader'
import { SearchField } from '@/ui/SearchField/SearchField'
import styles from '@/screens/Search/Search.module.scss'

/** What Search shows: the Browse tiles and recent searches, or what a search found. */
const SEARCH_MODES = { idle: 'idle', results: 'results' } as const

type SearchMode = (typeof SEARCH_MODES)[keyof typeof SEARCH_MODES]

type BodyProps = ResultsProps & { onSearch: (text: string) => void }

function IdleBody({ onSearch }: BodyProps) {
  return <SearchIdle onSearch={onSearch} />
}

const SEARCH_BODIES = {
  [SEARCH_MODES.idle]: IdleBody,
  [SEARCH_MODES.results]: SearchResults,
} as const satisfies Record<SearchMode, ComponentType<BodyProps>>

/**
 * `/search`: the Browse tiles and recent searches until something is typed, then the albums,
 * artists and songs of every music library that match, asked for once typing pauses.
 */
export function Search() {
  const search = useSearch()
  const [filter, setFilter] = useState<SearchFilter>(SEARCH_FILTERS.all)
  const results = useSearchResults({ query: search.query })
  const actions = useResultActions({ query: search.query })
  const remember = useRecentSearches((state) => state.remember)
  const mode = search.query === '' ? SEARCH_MODES.idle : SEARCH_MODES.results
  const isIdle = mode === SEARCH_MODES.idle
  const searchFor = (text: string) => {
    setFilter(SEARCH_FILTERS.all)
    search.searchFor(text)
  }
  const submit = () => {
    search.searchNow()
    remember({ kind: RECENT_KINDS.query, text: search.text.trim() })
  }
  const clear = () => searchFor('')
  const Body = SEARCH_BODIES[mode]
  return (
    <Page>
      <div className={styles.search}>
        <div className={styles.pinned}>
          {isIdle && <PageHeader title={SEARCH_COPY.title} />}
          <SearchField
            label={SEARCH_COPY.label}
            onCancel={clear}
            onChangeText={search.setText}
            onSubmit={submit}
            value={search.text}
          />
          {!isIdle && (
            <FilterChips
              chips={FILTER_CHIPS}
              label={SEARCH_COPY.filters}
              onSelect={setFilter}
              selected={filter}
            />
          )}
        </div>
        <Body
          actions={actions}
          filter={filter}
          onClear={clear}
          onFilter={setFilter}
          onSearch={searchFor}
          query={search.query}
          results={results}
        />
      </div>
    </Page>
  )
}
