import { MAX_WATCH_TARGETS } from '@raven/core'
import { useRef, useState } from 'react'
import { Button, useKeyShortcut } from '@raven/ui'
import {
  useSelectButtonRef,
  useSelection,
  useSelectionScope,
} from '@/components/SelectionScope/SelectionScope'
import { useReturnFocus } from '@/lib/useReturnFocus'
import { useWatchedChange } from '@/lib/useWatchedChange'
import type { SelectionScopeValue } from '@/stores/selectionScope'
import styles from '@/components/SelectionBar/SelectionBar.module.scss'

const OUTCOME_TYPES = { marked: 'marked', failed: 'failed' } as const

/** What marking the selection came to, for the selection it was made on. */
type Result = {
  keys: ReadonlySet<string>
  outcome:
    | { type: typeof OUTCOME_TYPES.marked; count: number; watched: boolean }
    | { type: typeof OUTCOME_TYPES.failed }
}

/** `list` cut into parts of at most `size`, in order. */
const inParts = <T,>({ list, size }: { list: readonly T[]; size: number }): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, index) =>
    list.slice(index * size, (index + 1) * size),
  )

/** The bar while selecting: the count, what marking came to, and the buttons. */
const SelectingBar = ({ scope }: { scope: SelectionScopeValue }) => {
  const { store, resolve, allKeys } = scope
  const keys = useSelection((state) => state.keys)
  const change = useWatchedChange()
  const [result, setResult] = useState<Result | null>(null)
  useKeyShortcut({ key: 'escape', onPress: () => store.getState().end(), inCheckboxes: true })

  // One request marks the selection; more than the server takes at once goes in parts, in order.
  const mark = async (watched: boolean) => {
    const targets = [...keys].flatMap((key) => resolve(key))
    if (targets.length === 0) return
    try {
      await Promise.all(
        inParts({ list: targets, size: MAX_WATCH_TARGETS }).map((part) =>
          change.mutateAsync({ watched, targets: part }),
        ),
      )
      setResult({ keys, outcome: { type: OUTCOME_TYPES.marked, count: keys.size, watched } })
    } catch {
      setResult({ keys, outcome: { type: OUTCOME_TYPES.failed } })
    }
  }

  // What was said of one selection does not outlast a change to it.
  const outcome = result?.keys === keys ? result.outcome : null
  const isEmpty = keys.size === 0
  const { selectAll, clear, end } = store.getState()

  return (
    <section className={styles.bar} aria-label="Selection">
      <div className={styles.status}>
        <output className={styles.count}>
          <span>{keys.size} selected</span>
          {outcome?.type === OUTCOME_TYPES.marked && (
            <span className={styles.outcome}>
              <span className="visually-hidden">. </span>
              Marked {outcome.count} {outcome.watched ? 'watched' : 'unwatched'}
            </span>
          )}
        </output>
        {outcome?.type === OUTCOME_TYPES.failed && (
          <p className={styles.failure} role="alert">
            Could not mark. Try again.
          </p>
        )}
      </div>
      <div className={styles.actions}>
        <Button className={styles.button} onClick={() => selectAll(allKeys())}>
          Select all
        </Button>
        <Button
          className={styles.button}
          disabled={isEmpty || change.isPending}
          onClick={() => mark(true)}
        >
          Mark watched
        </Button>
        <Button
          className={styles.button}
          disabled={isEmpty || change.isPending}
          onClick={() => mark(false)}
        >
          Mark unwatched
        </Button>
        <Button className={styles.button} disabled={isEmpty} onClick={clear}>
          Clear
        </Button>
        <Button className={styles.button} tone="primary" onClick={end}>
          Done
        </Button>
      </div>
    </section>
  )
}

/**
 * The bar at the foot of a scope that is selecting, counting the selection
 * and marking it watched or unwatched in one request. Done and Escape end
 * select mode, and focus goes back to the Select button that began it.
 */
export const SelectionBar = () => {
  const scope = useSelectionScope()
  const selecting = useSelection((state) => state.selecting)
  const unused = useRef<HTMLButtonElement>(null)
  const selectButton = useSelectButtonRef()
  useReturnFocus({ isOpen: selecting, target: selectButton ?? unused })
  if (!scope || !selecting) return null
  return <SelectingBar scope={scope} />
}
