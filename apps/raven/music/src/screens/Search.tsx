import { useSearch } from '@raven/ui/headless'
import {
  FILTER_CHIPS,
  RECENT_KINDS,
  SEARCH_COPY,
  SEARCH_FILTERS,
  type SearchFilter,
} from '@raven/wren'
import { type ComponentType, useState } from 'react'
import { Keyboard, ScrollView, View, useWindowDimensions } from 'react-native'

import { useCovers } from '@/music/useCovers'
import type { ResultsProps } from '@/screens/search/ResultParts'
import { SearchIdle } from '@/screens/search/SearchIdle'
import { SearchResults } from '@/screens/search/SearchResults'
import { useResultActions } from '@/screens/search/useResultActions'
import { useSearchResults } from '@/screens/search/useSearchResults'
import { usePageInsets } from '@/shell/useShell'
import { useRecentSearches } from '@/stores/recentSearches'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SPACE } from '@/theme/wrenTokens'
import { FilterChips } from '@/ui/FilterChips'
import { PageHeader } from '@/ui/PageHeader'
import { SearchField } from '@/ui/SearchField'
import { type WrenSession, useWren } from '@/useWren'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  page: { backgroundColor: colors.bg, flex: 1 },
  header: { gap: SPACE.s4, paddingBottom: SPACE.s4 },
  scroller: { backgroundColor: colors.bg, flex: 1 },
}))

/** What Search shows: the Browse tiles and recent searches, or what a search found. */
const SEARCH_MODES = { idle: 'idle', results: 'results' } as const

type SearchMode = (typeof SEARCH_MODES)[keyof typeof SEARCH_MODES]

type BodyProps = ResultsProps & { onSearch: (text: string) => void }

function IdleBody({ width, onSearch, contentStyle }: BodyProps) {
  const styles = useStyles()
  return (
    <ScrollView
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
      style={styles.scroller}
    >
      <SearchIdle onSearch={onSearch} width={width} />
    </ScrollView>
  )
}

const SEARCH_BODIES = {
  [SEARCH_MODES.idle]: IdleBody,
  [SEARCH_MODES.results]: SearchResults,
} as const satisfies Record<SearchMode, ComponentType<BodyProps>>

type SearchPageProps = { session: WrenSession }

function SearchPage({ session }: SearchPageProps) {
  const styles = useStyles()
  const insets = usePageInsets()
  const window = useWindowDimensions()
  const [pageWidth, setPageWidth] = useState(window.width)
  const search = useSearch()
  const [filter, setFilter] = useState<SearchFilter>(SEARCH_FILTERS.all)
  const results = useSearchResults({ session, query: search.query })
  const actions = useResultActions({ session, query: search.query })
  const covers = useCovers(session)
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
  const cancel = () => {
    clear()
    Keyboard.dismiss()
  }
  const Body = SEARCH_BODIES[mode]
  return (
    <View
      onLayout={({ nativeEvent }) => setPageWidth(nativeEvent.layout.width)}
      style={styles.page}
    >
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.paddingTop,
            paddingLeft: insets.paddingLeft,
            paddingRight: insets.paddingRight,
          },
        ]}
      >
        {isIdle && <PageHeader title={SEARCH_COPY.title} />}
        <SearchField
          label={SEARCH_COPY.label}
          onCancel={cancel}
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
      </View>
      <Body
        actions={actions}
        contentStyle={{
          paddingLeft: insets.paddingLeft,
          paddingRight: insets.paddingRight,
          paddingBottom: insets.paddingBottom,
        }}
        covers={covers}
        filter={filter}
        onClear={clear}
        onFilter={setFilter}
        onSearch={searchFor}
        query={search.query}
        results={results}
        width={pageWidth - insets.paddingLeft - insets.paddingRight}
      />
    </View>
  )
}

/**
 * Search: the Browse tiles and recent searches until something is typed, then the albums,
 * artists and songs of every music library that match, asked for once typing pauses.
 */
export function Search() {
  const session = useWren()
  return session !== null && <SearchPage session={session} />
}
