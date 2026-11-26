import type { ComponentType, ReactNode } from 'react'
import { type CollectionSearch } from '@raven/wren-native'
import { Text, View } from 'react-native'

import { LIBRARY_PAGE_COPY } from '@raven/wren'
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

type CollectionHeaderProps = {
  title: string
  /** "< Library": the way back on a phone; the tablet's sidebar is its way back. */
  onBack: () => void
  /** What sits at the title's end: New playlist. */
  actions?: ReactNode
  search?: CollectionSearch
  /** How many the list holds, "1,980 albums", or null until it is known. */
  count: string | null
  /** The list's choice buttons: Sort, and Albums' Cover size after it. */
  tools?: ReactNode
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

/** A phone's header: back, the title, what sits under it, the search, then the count and tools. */
function PhoneHeader({
  title,
  onBack,
  actions,
  search,
  count,
  tools,
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
      {(count !== null || tools !== undefined) && (
        <View style={styles.countRow}>
          <Text style={styles.count}>{count ?? ''}</Text>
          {tools !== undefined && <View style={styles.tools}>{tools}</View>}
        </View>
      )}
    </View>
  )
}

/** A tablet's header: the title with the search and tools at its end, the count under it. */
function TabletHeader({ title, actions, search, count, tools, children }: CollectionHeaderProps) {
  const styles = useStyles()
  const end = (
    <View style={styles.tools}>
      {search !== undefined && (
        <View style={styles.tabletSearch}>
          <Search search={search} />
        </View>
      )}
      {tools}
      {actions}
    </View>
  )
  return (
    <View style={styles.header}>
      <PageHeader actions={end} title={title} />
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
