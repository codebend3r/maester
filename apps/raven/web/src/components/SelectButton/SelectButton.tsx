import { Button } from '@raven/ui'
import {
  useSelectButtonRef,
  useSelection,
  useSelectionScope,
} from '@/components/SelectionScope/SelectionScope'

/**
 * Starts select mode in the scope it sits in, and ends it when pressed
 * again. It gets the focus back when the bar closes the mode. Outside a
 * scope there is nothing to select, so it is not there.
 */
export const SelectButton = ({ className }: { className?: string }) => {
  const scope = useSelectionScope()
  const selecting = useSelection((state) => state.selecting)
  const ref = useSelectButtonRef()
  if (!scope) return null
  return (
    <Button
      ref={ref}
      icon="check"
      className={className}
      aria-pressed={selecting}
      onClick={() => (selecting ? scope.store.getState().end() : scope.store.getState().start())}
    >
      Select
    </Button>
  )
}
