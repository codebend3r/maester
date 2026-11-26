import { useSearch } from '@raven/ui/headless'
import {
  FILTER_CHIPS,
  KIT_COPY,
  RECENT_KINDS,
  SEARCH_COPY,
  SEARCH_FILTERS,
  type SearchFilter,
} from '@raven/wren'
import { type ComponentType, useState } from 'react'
import { View } from 'react-native'
import {
  useCovers,
  useResultActions,
  useRecentSearches,
  type WrenSession,
  useWren,
  useSearchResults,
} from '@raven/wren-native'

import type { ResultsProps } from '@/screens/search/parts'
import { Results } from '@/screens/search/Results'
import { SearchIdle } from '@/screens/search/SearchIdle'
import { SPACE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { ChoiceRow } from '@/ui/ChoiceRow'
import { PageHeader } from '@/ui/Headers'
import { TextField } from '@/ui/TextField'

const useStyles = themedStyles(({ colors }) => ({
  page: { backgroundColor: colors.bg, flex: 1, gap: SPACE.s4, padding: SPACE.gutter },
  header: { gap: SPACE.s4 },
}))

/** What Search shows: the Browse tiles and recent searches, or what a search found. */
const SEARCH_MODES = { idle: 'idle', results: 'results' } as const

type SearchMode = (typeof SEARCH_MODES)[keyof typeof SEARCH_MODES]

type BodyProps = ResultsProps & { onSearch: (text: string) => void }

const IdleBody = ({ onSearch }: BodyProps) => <SearchIdle onSearch={onSearch} />

const SEARCH_BODIES = {
  [SEARCH_MODES.idle]: IdleBody,
  [SEARCH_MODES.results]: Results,
} as const satisfies Record<SearchMode, ComponentType<BodyProps>>

type SearchPageProps = { session: WrenSession }

function SearchPage({ session }: SearchPageProps) {
  const styles = useStyles()
  const search = useSearch()
  const [filter, setFilter] = useState<SearchFilter>(SEARCH_FILTERS.all)
  const results = useSearchResults({ session, query: search.query })
  const actions = useResultActions({ session, query: search.query })
  const covers = useCovers(session)
  const remember = useRecentSearches((state) => state.remember)
  const mode = search.query === '' ? SEARCH_MODES.idle : SEARCH_MODES.results
  const searchFor = (text: string) => {
    setFilter(SEARCH_FILTERS.all)
    search.searchFor(text)
  }
  // The TV keyboard's Search searches at once, as Enter does on every Wren, and remembers the words.
  const submit = () => {
    search.searchNow()
    remember({ kind: RECENT_KINDS.query, text: search.text.trim() })
  }
  const Body = SEARCH_BODIES[mode]
  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <PageHeader title={SEARCH_COPY.title} />
        <TextField
          hasPreferredFocus
          label={SEARCH_COPY.label}
          onChangeText={search.setText}
          onSubmitEditing={submit}
          placeholder={KIT_COPY.searchPlaceholder}
          returnKeyType="search"
          value={search.text}
        />
        {mode === SEARCH_MODES.results && (
          <ChoiceRow
            choices={FILTER_CHIPS}
            label={SEARCH_COPY.filters}
            onSelect={setFilter}
            selected={filter}
          />
        )}
      </View>
      <Body
        actions={actions}
        covers={covers}
        filter={filter}
        onClear={() => searchFor('')}
        onFilter={setFilter}
        onSearch={searchFor}
        query={search.query}
        results={results}
      />
    </View>
  )
}

/**
 * Search: the Browse tiles and recent searches until something is typed on the TV's keyboard,
 * then the albums, artists and songs of the music library that match, asked for once typing
 * pauses, or at once on the keyboard's Search.
 */
export function Search() {
  const session = useWren()
  return session !== null && <SearchPage session={session} />
}
