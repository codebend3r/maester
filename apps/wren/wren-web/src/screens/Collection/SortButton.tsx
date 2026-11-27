import type { MusicSort } from '@raven/core'
import { LIBRARY_PAGE_COPY, MUSIC_SORT_OPTIONS, WREN_ICONS } from '@raven/wren'
import { ChoiceButton } from '@/screens/Collection/ChoiceButton'

type SortButtonProps = { sort: MusicSort; onSort: (sort: MusicSort) => void }

/** The sort a list is in; a press opens a sheet of raven's sorts. */
export function SortButton({ sort, onSort }: SortButtonProps) {
  return (
    <ChoiceButton
      chosen={sort}
      icon={WREN_ICONS.sort}
      onChoose={onSort}
      options={MUSIC_SORT_OPTIONS}
      spokenLabelOf={LIBRARY_PAGE_COPY.sortLabel}
      title={LIBRARY_PAGE_COPY.sortBy}
    />
  )
}
