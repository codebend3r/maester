import { Icon } from '@raven/ui'
import { useId } from 'react'
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
        Search every library
      </label>
      <SearchField
        id={id}
        search={search}
        className={styles.input}
        placeholder="Search every library"
      />
      <span className={styles.icon}>
        <Icon name="search" size={20} />
      </span>
    </search>
  )
}
