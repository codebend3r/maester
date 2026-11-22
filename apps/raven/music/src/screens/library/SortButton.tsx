import { MUSIC_SORTS, MUSIC_SORT_LABELS, type MusicSort } from '@raven/core'
import { LIBRARY_PAGE_COPY } from '@raven/wren'

import { ChoiceButton } from '@/screens/library/ChoiceButton'
import { ICONS } from '@/ui/WrenIcon'

/** raven's music sorts, in raven's order and in raven's words. */
const SORT_OPTIONS = Object.values(MUSIC_SORTS).map((sort) => ({
  value: sort,
  label: MUSIC_SORT_LABELS[sort],
}))

type SortButtonProps = { sort: MusicSort; onSort: (sort: MusicSort) => void }

/** The sort a list is in; a press opens a sheet of raven's sorts. */
export function SortButton({ sort, onSort }: SortButtonProps) {
  return (
    <ChoiceButton
      chosen={sort}
      icon={ICONS.sort}
      onChoose={onSort}
      options={SORT_OPTIONS}
      spokenLabelOf={LIBRARY_PAGE_COPY.sortLabel}
      title={LIBRARY_PAGE_COPY.sortBy}
    />
  )
}
