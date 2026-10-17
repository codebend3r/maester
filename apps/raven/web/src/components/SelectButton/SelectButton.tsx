import { Button } from '@raven/ui'
import {
  useSelectButtonRef,
  useSelection,
  useSelectionScope,
} from '@/components/SelectionScope/SelectionScope'
import styles from '@/components/SelectButton/SelectButton.module.scss'

/**
 * Starts select mode in the scope it sits in, and ends it when pressed
 * again: a pill, outlined while off and filled in bark while selecting. It
 * gets the focus back when the bar closes the mode. Outside a scope there
 * is nothing to select, so it is not there.
 */
export const SelectButton = ({ className }: { className?: string }) => {
  const scope = useSelectionScope()
  const selecting = useSelection((state) => state.selecting)
  const ref = useSelectButtonRef()
  if (!scope) return null
  return (
    <Button
      ref={ref}
      tone="ghost"
      icon="check"
      className={className ? `${styles.select} ${className}` : styles.select}
      aria-pressed={selecting}
      onClick={() => (selecting ? scope.store.getState().end() : scope.store.getState().start())}
    >
      Select
    </Button>
  )
}
