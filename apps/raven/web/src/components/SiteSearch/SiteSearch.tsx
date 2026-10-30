import { Icon } from '@raven/ui'
import { useId } from 'react'
import { SITE_SEARCH_COPY } from '@/components/SiteSearch/copy'
import { SearchField } from '@/components/SearchField/SearchField'
import { useAddressSearch } from '@/lib/useSearch'
import styles from '@/components/SiteSearch/SiteSearch.module.scss'

type SiteSearchProps = { className?: string }

/**
 * The search through every library at the top of every page. Its results
 * are home's: on home the box rides in the address as `?q=`, and anywhere
 * else a search opens home on it.
 */
export const SiteSearch = ({ className }: SiteSearchProps) => {
  const id = useId()
  const search = useAddressSearch({ page: '/' })
  return (
    <search className={[styles.search, className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className="visually-hidden">
        {SITE_SEARCH_COPY.searchEveryLibrary}
      </label>
      <SearchField
        id={id}
        search={search}
        className={styles.input}
        placeholder={SITE_SEARCH_COPY.searchEveryLibrary}
      />
      <span className={styles.icon}>
        <Icon name="search" size={20} />
      </span>
    </search>
  )
}
