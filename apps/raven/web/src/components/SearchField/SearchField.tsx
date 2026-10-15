import type { ComponentProps } from 'react'
import type { Search } from '@/lib/useSearch'

/**
 * A search box. Every one in raven is this, held by `useSearch`, so none
 * searches on each keystroke: what it asks for follows the typing once it
 * pauses, or at once on Enter. The label is the caller's.
 */
export const SearchField = ({
  search,
  ...input
}: { search: Search } & Omit<
  ComponentProps<'input'>,
  'type' | 'value' | 'defaultValue' | 'onChange' | 'onKeyDown'
>) => (
  <input
    {...input}
    type="search"
    value={search.text}
    onChange={(event) => search.setText(event.target.value)}
    onKeyDown={(event) => {
      if (event.key === 'Enter') search.searchNow()
    }}
  />
)
