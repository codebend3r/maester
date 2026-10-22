import { KEYS } from '@raven/core'
import { type KeyboardEvent, useEffect, useRef } from 'react'

/**
 * A modal dialog that opens as it mounts. The player listens on the window, so a key pressed in
 * the dialog stays there, and Escape closes the dialog itself, never relying on the browser's
 * cancel, which a cancelled keydown suppresses. The dialog's close event hears every way out.
 */
export const useModal = () => {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (dialog.current !== null && !dialog.current.open) dialog.current.showModal()
  }, [])
  const close = () => dialog.current?.close()
  const keepKeys = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.key !== KEYS.escape) return
    event.preventDefault()
    close()
  }
  return { dialog, close, keepKeys }
}
