import type { WatchTarget } from '@raven/core'
import type { ReactNode } from 'react'
import { SelectButton } from '@/components/SelectButton/SelectButton'
import { SelectionBar } from '@/components/SelectionBar/SelectionBar'
import { SelectionScope, sourceOf } from '@/components/SelectionScope/SelectionScope'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

/**
 * A tab's cards that can be selected: a small header holding Select above
 * them, and the bar below. `entries` is each card's key and what marking it
 * marks.
 */
export const SelectableCards = ({
  entries,
  children,
}: {
  entries: readonly (readonly [string, readonly WatchTarget[]])[]
  children: ReactNode
}) => (
  <SelectionScope {...sourceOf(entries)}>
    <header className={styles.selectHeader}>
      <SelectButton />
    </header>
    {children}
    <SelectionBar />
  </SelectionScope>
)
