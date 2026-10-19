import { KEYS } from '@raven/core'
import type { ComponentProps } from 'react'
import type { Search } from '@/lib/useSearch'
import styles from '@/components/SearchField/SearchField.module.scss'

/**
 * A search box. Every one in raven is this, held by `useSearch`, so none
 * searches on each keystroke: what it asks for follows the typing once it
 * pauses, or at once on Enter. The label, the size and the place are the
 * caller's; it draws only its clear button, in the theme's lichen.
 */
export const SearchField = ({
  search,
  className,
  ...input
}: { search: Search } & Omit<
  ComponentProps<'input'>,
  'type' | 'value' | 'defaultValue' | 'onChange' | 'onKeyDown'
>) => (
  <input
    {...input}
    type="search"
    className={[styles.field, className].filter(Boolean).join(' ')}
    value={search.text}
    onChange={(event) => search.setText(event.target.value)}
    onKeyDown={(event) => {
      if (event.key === KEYS.enter) search.searchNow()
    }}
  />
)
