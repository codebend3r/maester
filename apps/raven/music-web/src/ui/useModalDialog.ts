import { type SyntheticEvent, useEffect, useRef } from 'react'

type UseModalDialogProps = {
  isOpen: boolean
  /** Asked by Escape: the screen decides, and its `isOpen` closes the dialog. */
  onClose: () => void
}

/**
 * Holds a `<dialog>` open as a modal while `isOpen`, so the browser keeps the focus inside it,
 * hides the page behind it from a screen reader and hears Escape, which asks `onClose` rather
 * than closing the dialog itself. Hands back the `ref` and `onCancel` the dialog wears.
 */
export const useModalDialog = ({ isOpen, onClose }: UseModalDialogProps) => {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = ref.current
    if (element === null) return
    if (isOpen && !element.open) element.showModal()
    if (!isOpen && element.open) element.close()
  }, [isOpen])
  const onCancel = (event: SyntheticEvent) => {
    event.preventDefault()
    onClose()
  }
  return { ref, onCancel }
}
