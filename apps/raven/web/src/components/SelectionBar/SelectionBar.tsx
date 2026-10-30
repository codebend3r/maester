import { MAX_WATCH_TARGETS } from '@raven/core'
import { useRef, useState } from 'react'
import { Button, useKeyShortcut } from '@raven/ui'
import {
  useSelectButtonRef,
  useSelection,
  useSelectionScope,
} from '@/components/SelectionScope/SelectionScope'
import { SELECTION_BAR_COPY } from '@/components/SelectionBar/copy'
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

type InPartsProps<T> = { list: readonly T[]; size: number }

/** `list` cut into parts of at most `size`, in order. */
const inParts = <T,>({ list, size }: InPartsProps<T>): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, index) =>
    list.slice(index * size, (index + 1) * size),
  )

type SelectingBarProps = { scope: SelectionScopeValue }

/** The bar while selecting: the count, what marking came to, and the buttons. */
const SelectingBar = ({ scope }: SelectingBarProps) => {
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
    <section className={styles.bar} aria-label={SELECTION_BAR_COPY.label}>
      <div className={styles.status}>
        <output className={styles.count}>
          <span>{SELECTION_BAR_COPY.selected(keys.size)}</span>
          {outcome?.type === OUTCOME_TYPES.marked && (
            <span className={styles.outcome}>
              <span className="visually-hidden">{SELECTION_BAR_COPY.pause}</span>
              {SELECTION_BAR_COPY.marked(outcome)}
            </span>
          )}
        </output>
        {outcome?.type === OUTCOME_TYPES.failed && (
          <p className={styles.failure} role="alert">
            {SELECTION_BAR_COPY.failed}
          </p>
        )}
      </div>
      <div className={styles.actions}>
        <Button className={styles.button} onClick={() => selectAll(allKeys())}>
          {SELECTION_BAR_COPY.selectAll}
        </Button>
        <Button
          className={styles.button}
          disabled={isEmpty || change.isPending}
          onClick={() => mark(true)}
        >
          {SELECTION_BAR_COPY.markWatched}
        </Button>
        <Button
          className={styles.button}
          disabled={isEmpty || change.isPending}
          onClick={() => mark(false)}
        >
          {SELECTION_BAR_COPY.markUnwatched}
        </Button>
        <Button className={styles.button} disabled={isEmpty} onClick={clear}>
          {SELECTION_BAR_COPY.clear}
        </Button>
        <Button className={styles.button} tone="primary" onClick={end}>
          {SELECTION_BAR_COPY.done}
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
  return scope !== null && selecting && <SelectingBar scope={scope} />
}
