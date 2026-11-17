import type { ComponentType, ReactNode } from 'react'
import { Text, View } from 'react-native'

import { LIBRARY_PAGE_COPY } from '@/screens/copy'
import { SortButton } from '@/screens/library/SortButton'
import type { ListSort } from '@/screens/library/sorts'
import { type WrenTheme, themedStyles, useFormFactor } from '@/theme/wrenTheme'
import { SIZE, SPACE, TYPE, FORM_FACTORS, type FormFactor } from '@/theme/wrenTokens'
import { PageHeader } from '@/ui/PageHeader'
import { SearchField } from '@/ui/SearchField'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  header: { gap: SPACE.s4 },
  countRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACE.s3,
    justifyContent: 'space-between',
    minHeight: SIZE.touchTarget,
  },
  count: { ...TYPE.meta, color: colors.text2, flex: 1 },
  tools: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s3 },
  // The tablet's field keeps to a short measure beside the title.
  tabletSearch: { width: SIZE.emptyMeasure },
}))

/** A list's search box: what is typed and what it asks for. */
type CollectionSearch = {
  value: string
  onChangeText: (text: string) => void
  placeholder: string
}

/** A list's order and the way to change it. */
type CollectionSort = { sort: ListSort; onSort: (sort: ListSort) => void }

type CollectionHeaderProps = {
  title: string
  /** "< Library": the way back on a phone; the tablet's sidebar is its way back. */
  onBack: () => void
  /** What sits at the title's end: New playlist. */
  actions?: ReactNode
  search?: CollectionSearch
  /** How many the list holds, "1,980 albums", or null until it is known. */
  count?: string | null
  sort?: CollectionSort
  /** What sits between the title and the list's tools: Play and Shuffle, the storage card. */
  children?: ReactNode
}

type SearchProps = { search: CollectionSearch }

function Search({ search }: SearchProps) {
  return (
    <SearchField
      label={search.placeholder}
      onChangeText={search.onChangeText}
      placeholder={search.placeholder}
      value={search.value}
    />
  )
}

/** A phone's header: back, the title, what sits under it, the search, then the count and sort. */
function PhoneHeader({
  title,
  onBack,
  actions,
  search,
  count = null,
  sort,
  children,
}: CollectionHeaderProps) {
  const styles = useStyles()
  return (
    <View style={styles.header}>
      <PageHeader
        actions={actions}
        back={{ label: LIBRARY_PAGE_COPY.title, onPress: onBack }}
        title={title}
      />
      {children}
      {search !== undefined && <Search search={search} />}
      {(count !== null || sort !== undefined) && (
        <View style={styles.countRow}>
          <Text style={styles.count}>{count ?? ''}</Text>
          {sort !== undefined && <SortButton onSort={sort.onSort} sort={sort.sort} />}
        </View>
      )}
    </View>
  )
}

/** A tablet's header: the title with the search and sort at its end, the count under it. */
function TabletHeader({
  title,
  actions,
  search,
  count = null,
  sort,
  children,
}: CollectionHeaderProps) {
  const styles = useStyles()
  const tools = (
    <View style={styles.tools}>
      {search !== undefined && (
        <View style={styles.tabletSearch}>
          <Search search={search} />
        </View>
      )}
      {sort !== undefined && <SortButton onSort={sort.onSort} sort={sort.sort} />}
      {actions}
    </View>
  )
  return (
    <View style={styles.header}>
      <PageHeader actions={tools} title={title} />
      {count !== null && <Text style={styles.count}>{count}</Text>}
      {children}
    </View>
  )
}

const HEADERS = {
  [FORM_FACTORS.phone]: PhoneHeader,
  [FORM_FACTORS.tablet]: TabletHeader,
} as const satisfies Record<FormFactor, ComponentType<CollectionHeaderProps>>

/** A category page's header, laid out for the phone or the tablet. */
export function CollectionHeader(props: CollectionHeaderProps) {
  const Header = HEADERS[useFormFactor()]
  return <Header {...props} />
}
