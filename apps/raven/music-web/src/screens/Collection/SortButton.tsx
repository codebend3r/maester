import { classNames } from '@raven/ui/headless'
import { LIBRARY_PAGE_COPY, LIST_SORT_LABELS, LIST_SORT_ORDER, type ListSort } from '@raven/wren'
import { useState } from 'react'
import { COLORS, SIZES } from '@/theme/tokens'
import { BottomSheet } from '@/ui/BottomSheet/BottomSheet'
import { Pressable } from '@/ui/Pressable/Pressable'
import { ICONS } from '@/ui/WrenIcon/icons'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/screens/Collection/SortButton.module.scss'

type SortButtonProps = { sort: ListSort; onSort: (sort: ListSort) => void }

/**
 * The sort a list is in, as a red link on the narrow layout and an outlined button on the wide.
 * A press opens a sheet of the sorts, the one in use checked.
 */
export function SortButton({ sort, onSort }: SortButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const label = LIST_SORT_LABELS[sort]
  const choose = (next: ListSort) => {
    onSort(next)
    setIsOpen(false)
  }
  return (
    <>
      <Pressable
        className={styles.button}
        label={LIBRARY_PAGE_COPY.sortLabel(label)}
        onPress={() => setIsOpen(true)}
      >
        <WrenIcon name={ICONS.sort} size={SIZES.smallIcon} />
        {label}
      </Pressable>
      <BottomSheet
        head={{ title: LIBRARY_PAGE_COPY.sortBy }}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      >
        <div aria-label={LIBRARY_PAGE_COPY.sortBy} className={styles.options} role="radiogroup">
          {LIST_SORT_ORDER.map((option) => (
            <button
              aria-checked={option === sort}
              className={classNames([styles.option, option === sort && styles.chosen])}
              key={option}
              onClick={() => choose(option)}
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a pick closes the sheet, which an input's arrow keys would do on the way past each sort
              role="radio"
              type="button"
            >
              <span className={styles.optionLabel}>{LIST_SORT_LABELS[option]}</span>
              {option === sort && (
                <WrenIcon color={COLORS.accentText} name={ICONS.check} size={SIZES.smallIcon} />
              )}
            </button>
          ))}
        </div>
      </BottomSheet>
    </>
  )
}
