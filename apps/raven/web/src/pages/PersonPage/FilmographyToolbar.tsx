import { FILMOGRAPHY_TABS, type FilmographyTab } from '@raven/core'
import { Icon } from '@raven/ui'
import { useId } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { SearchField } from '@/components/SearchField/SearchField'
import type { Search } from '@raven/ui/headless'
import styles from '@/pages/PersonPage/FilmographyToolbar.module.scss'

const TAB_LABELS: Record<FilmographyTab, string> = {
  all: 'All',
  acting: 'Acting',
  directing: 'Directing',
  writing: 'Writing',
  producing: 'Producing',
}

const count = new Intl.NumberFormat()

type TabSearchProps = { address: URLSearchParams; tab: FilmographyTab }

/** The address of tab `tab`, the rest of `address` kept: All's is the page's own, with no `?credits=`. */
const tabSearch = ({ address, tab }: TabSearchProps): string => {
  const next = new URLSearchParams(address)
  if (tab === 'all') next.delete('credits')
  else next.set('credits', tab)
  const query = next.toString()
  return query === '' ? '' : `?${query}`
}

type FilmographyToolbarProps = {
  search: Search
  tab: FilmographyTab
  counts: Record<FilmographyTab, number>
  hasSelfCredits: boolean
  isSelfShown: boolean
  onSelfShownChange: (isShown: boolean) => void
}

/**
 * The search over titles and roles, the toggle for appearances as
 * themselves where there are any, and the tabs with something on them,
 * All always. Each tab is named with its count, "Directing, 52", so a
 * screen reader hears the two apart rather than run together. The tabs
 * replace the address rather than stack on it, so Back leaves the page.
 */
export const FilmographyToolbar = ({
  search,
  tab,
  counts,
  hasSelfCredits,
  isSelfShown,
  onSelfShownChange,
}: FilmographyToolbarProps) => {
  const id = useId()
  const [address] = useSearchParams()
  return (
    <div className={styles.toolbar}>
      <search className={styles.find}>
        <div className={styles.search}>
          <label htmlFor={id} className="visually-hidden">
            Search titles
          </label>
          <span className={styles.searchIcon}>
            <Icon name="search" size={18} />
          </span>
          <SearchField
            id={id}
            search={search}
            className={styles.input}
            placeholder="Search titles"
          />
        </div>
        {hasSelfCredits && (
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={isSelfShown}
              onChange={(event) => onSelfShownChange(event.target.checked)}
            />
            Show appearances as themselves
          </label>
        )}
      </search>
      <nav aria-label="Credits" className={styles.tabsNav}>
        <ul className={styles.tabs}>
          {FILMOGRAPHY_TABS.filter((each) => each === 'all' || counts[each] > 0).map((each) => (
            <li key={each} className={styles.tabItem}>
              <Link
                to={{ search: tabSearch({ address, tab: each }) }}
                replace
                className={styles.tab}
                aria-current={each === tab ? 'page' : undefined}
                aria-label={`${TAB_LABELS[each]}, ${count.format(counts[each])}`}
              >
                {TAB_LABELS[each]}
                <span className={styles.tabCount}>{count.format(counts[each])}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
