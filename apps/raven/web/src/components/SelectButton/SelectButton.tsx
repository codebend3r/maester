import { Button } from '@raven/ui'
import {
  useSelectButtonRef,
  useSelection,
  useSelectionScope,
} from '@/components/SelectionScope/SelectionScope'
import { SELECT_BUTTON_COPY } from '@/components/SelectButton/copy'
import styles from '@/components/SelectButton/SelectButton.module.scss'

type SelectButtonProps = { className?: string }

/**
 * Starts select mode in the scope it sits in, and ends it when pressed
 * again: a pill, outlined while off and filled in bark while selecting. It
 * gets the focus back when the bar closes the mode. Outside a scope there
 * is nothing to select, so it is not there.
 */
export const SelectButton = ({ className }: SelectButtonProps) => {
  const scope = useSelectionScope()
  const selecting = useSelection((state) => state.selecting)
  const ref = useSelectButtonRef()
  return (
    scope !== null && (
      <Button
        ref={ref}
        tone="ghost"
        icon="check"
        className={className ? `${styles.select} ${className}` : styles.select}
        aria-pressed={selecting}
        onClick={() => (selecting ? scope.store.getState().end() : scope.store.getState().start())}
      >
        {SELECT_BUTTON_COPY.select}
      </Button>
    )
  )
}
