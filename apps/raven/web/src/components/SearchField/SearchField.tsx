import { KEYS } from '@raven/core'
import type { ComponentProps } from 'react'
import type { Search } from '@raven/ui/headless'
import styles from '@/components/SearchField/SearchField.module.scss'

type SearchFieldProps = { search: Search } & Omit<
  ComponentProps<'input'>,
  'type' | 'value' | 'defaultValue' | 'onChange'
>

/**
 * A search box. Every one in raven is this, held by `useSearch`, so none
 * searches on each keystroke: what it asks for follows the typing once it
 * pauses, or at once on Enter. The label, the size and the place are the
 * caller's; it draws only its clear button, in the theme's lichen. A
 * caller's `onKeyDown` hears each key first, and a key it takes with
 * `preventDefault` (an arrow through its suggestions) never reaches Enter's search.
 */
export const SearchField = ({ search, className, onKeyDown, ...input }: SearchFieldProps) => (
  <input
    {...input}
    type="search"
    className={[styles.field, className].filter(Boolean).join(' ')}
    value={search.text}
    onChange={(event) => search.setText(event.target.value)}
    onKeyDown={(event) => {
      onKeyDown?.(event)
      if (event.defaultPrevented) return
      if (event.key === KEYS.enter) search.searchNow()
    }}
  />
)
