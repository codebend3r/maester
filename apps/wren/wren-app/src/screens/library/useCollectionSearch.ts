import { useSearch } from '@raven/ui/headless'
import { emptyCopyOf } from '@raven/wren'

import type { CollectionSearch } from '@/screens/library/CollectionHeader'

type UseCollectionSearchProps = {
  /** What the box asks for: "Search albums". */
  placeholder: string
  /** What the list says when it holds nothing at all. */
  none: string
}

type CollectionSearchState = {
  /** What is searched for, once typing pauses. */
  query: string
  /** The header's search box. */
  field: CollectionSearch
  /** What the list says when it shows nothing: `none`, or that nothing matches the query. */
  empty: string
}

/** A category page's search: its box, the query it asks for, and what an empty list says. */
export const useCollectionSearch = ({
  placeholder,
  none,
}: UseCollectionSearchProps): CollectionSearchState => {
  const search = useSearch()
  return {
    query: search.query,
    field: { value: search.text, onChangeText: search.setText, placeholder },
    empty: emptyCopyOf({ query: search.query, none }),
  }
}
