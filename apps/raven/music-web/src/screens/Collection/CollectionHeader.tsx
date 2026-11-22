import { LIBRARY_PAGE_COPY, type ListSort } from '@raven/wren'
import type { ComponentType, ReactNode, Ref } from 'react'
import { WREN_ROUTES } from '@/routes'
import { SortButton } from '@/screens/Collection/SortButton'
import { useGoBack } from '@/shell/useGoBack'
import { FORM_FACTORS, type FormFactor, useFormFactor } from '@/theme/formFactor'
import { PageHeader } from '@/ui/PageHeader/PageHeader'
import { SearchField } from '@/ui/SearchField/SearchField'
import styles from '@/screens/Collection/CollectionHeader.module.scss'

/** A list's search box: what is typed and what it asks for. */
export type CollectionSearch = {
  value: string
  onChangeText: (text: string) => void
  placeholder: string
}

/** A list's order and the way to change it. */
type CollectionSort = { sort: ListSort; onSort: (sort: ListSort) => void }

type CollectionHeaderProps = {
  title: string
  /** What sits at the title's end: New playlist. */
  actions?: ReactNode
  search?: CollectionSearch
  /** How many the list holds, "1,980 albums", or null until it is known. */
  count: string | null
  sort?: CollectionSort
  /** What sits between the title and the list's tools: Play and Shuffle. */
  children?: ReactNode
  /** The header's own element, for a page that measures it: the artists' A to Z rail. */
  ref?: Ref<HTMLDivElement>
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

/*
 * The narrow header: "< Library", the title, what sits under it, the search, then the count and
 * sort. The way back is the narrow layout's alone; the sidebar is the wide one's.
 */
function PhoneHeader({
  title,
  actions,
  search,
  count,
  sort,
  children,
  ref,
}: CollectionHeaderProps) {
  // Opened from the sidebar or a link, there may be no page behind it.
  const onBack = useGoBack({ fallback: WREN_ROUTES.library })
  return (
    <div className={styles.header} ref={ref}>
      <PageHeader
        actions={actions}
        back={{ to: LIBRARY_PAGE_COPY.title, onPress: onBack }}
        title={title}
      />
      {children}
      {search !== undefined && <Search search={search} />}
      {(count !== null || sort !== undefined) && (
        <div className={styles.countRow}>
          <p className={styles.count}>{count ?? ''}</p>
          {sort !== undefined && <SortButton onSort={sort.onSort} sort={sort.sort} />}
        </div>
      )}
    </div>
  )
}

/** The wide header: the title with the search and sort at its end, the count under it. */
function TabletHeader({
  title,
  actions,
  search,
  count,
  sort,
  children,
  ref,
}: CollectionHeaderProps) {
  const tools = (
    <div className={styles.tools}>
      {search !== undefined && (
        <div className={styles.tabletSearch}>
          <Search search={search} />
        </div>
      )}
      {sort !== undefined && <SortButton onSort={sort.onSort} sort={sort.sort} />}
      {actions}
    </div>
  )
  return (
    <div className={styles.header} ref={ref}>
      <PageHeader actions={tools} title={title} />
      {count !== null && <p className={styles.count}>{count}</p>}
      {children}
    </div>
  )
}

const HEADERS = {
  [FORM_FACTORS.phone]: PhoneHeader,
  [FORM_FACTORS.tablet]: TabletHeader,
} as const satisfies Record<FormFactor, ComponentType<CollectionHeaderProps>>

/** A category page's header, laid out for the narrow layout or the wide. */
export function CollectionHeader(props: CollectionHeaderProps) {
  const Header = HEADERS[useFormFactor()]
  return <Header {...props} />
}
