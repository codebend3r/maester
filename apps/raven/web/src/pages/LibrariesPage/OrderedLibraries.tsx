import type { Library } from '@raven/core'
import { type DragEvent, useState } from 'react'
import { Button, Icon } from '@raven/ui'
import { LibraryIcon } from '@/components/LibraryIcon/LibraryIcon'
import type { useLibraryOrdering } from '@/lib/useLibraryOrdering'
import { LIBRARIES_COPY } from '@/pages/LibrariesPage/copy'
import styles from '@/pages/LibrariesPage/LibrariesPage.module.scss'

/** Firefox starts no drag that sets no data. */
const DRAG_DATA_TYPE = 'text/plain'

type ThinLibraryRowProps = {
  library: Library
  place: { isFirst: boolean; isLast: boolean; onMove: (step: number) => void }
  isDragging: boolean
  drag: {
    onStart: (event: DragEvent) => void
    onOver: (event: DragEvent) => void
    onEnd: () => void
  }
}

/**
 * A library in edit mode, down to a thin line: a grip, its icon and name, and
 * a button each to move it up or down, for the keyboard and for a touch
 * screen. The line itself drags; whichever line it is held over takes its place.
 */
const ThinLibraryRow = ({ library, place, isDragging, drag }: ThinLibraryRowProps) => (
  // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- dragging is the pointer's way; the move buttons are the keyboard's
  <li
    className={isDragging ? `${styles.thin} ${styles.dragging}` : styles.thin}
    draggable
    onDragStart={drag.onStart}
    onDragOver={drag.onOver}
    onDrop={(event) => event.preventDefault()}
    onDragEnd={drag.onEnd}
  >
    <span className={styles.grip} aria-hidden="true">
      <Icon name="grip" size={18} />
    </span>
    <span className={styles.thinWell}>
      <LibraryIcon settings={library.settings} size={18} />
    </span>
    <span className={styles.thinName}>{library.name}</span>
    <span className={styles.moves}>
      <Button
        icon="up"
        tone="ghost"
        aria-label={LIBRARIES_COPY.moveUp(library.name)}
        disabled={place.isFirst}
        onClick={() => place.onMove(-1)}
      />
      <Button
        icon="down"
        tone="ghost"
        aria-label={LIBRARIES_COPY.moveDown(library.name)}
        disabled={place.isLast}
        onClick={() => place.onMove(1)}
      />
    </span>
  </li>
)

type OrderedLibrariesProps = { ordering: ReturnType<typeof useLibraryOrdering> }

/**
 * The libraries while their order is edited: each a thin line to drag into
 * place, or to move with its buttons. The line being dragged is this list's
 * own to know; the order itself is the ordering's draft.
 */
export const OrderedLibraries = ({ ordering }: OrderedLibrariesProps) => {
  const [draggingId, setDraggingId] = useState<number | null>(null)
  return (
    <ul className={styles.list} aria-label={LIBRARIES_COPY.inOrder}>
      {ordering.ordered.map((library, index) => (
        <ThinLibraryRow
          key={library.id}
          library={library}
          isDragging={draggingId === library.id}
          place={{
            isFirst: index === 0,
            isLast: index === ordering.ordered.length - 1,
            onMove: (step) => ordering.move({ id: library.id, to: index + step }),
          }}
          drag={{
            onStart: (event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData(DRAG_DATA_TYPE, String(library.id))
              setDraggingId(library.id)
            },
            onOver: (event) => {
              event.preventDefault()
              if (draggingId === null || draggingId === library.id) return
              ordering.move({ id: draggingId, to: index })
            },
            onEnd: () => setDraggingId(null),
          }}
        />
      ))}
    </ul>
  )
}
