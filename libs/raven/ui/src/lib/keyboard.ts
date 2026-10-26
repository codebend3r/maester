import { useEffect } from 'react'

/** Form controls keep their own keys: what is typed, a radio's arrows, a slider's. */
export const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && !!target.closest('input, select, textarea')

const INPUT_TYPES = { checkbox: 'checkbox' } as const

const isCheckbox = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement && target.type === INPUT_TYPES.checkbox

type IsInForeignDialogProps = {
  target: EventTarget | null
  root: Element | null
}

/** Whether a key comes from a dialog outside `root`: a dialog someone else opened keeps its keys. */
export const isInForeignDialog = ({ target, root }: IsInForeignDialogProps): boolean => {
  if (!(target instanceof Element)) return false
  const dialog = target.closest('dialog')
  return dialog !== null && !(root?.contains(dialog) ?? false)
}

type IsShortcutProps = {
  event: KeyboardEvent
  key: string
  inCheckboxes?: boolean
}

/**
 * Whether a press is `key` on its own, whatever its case: no Ctrl, Cmd or
 * Alt (those belong to the browser), no auto-repeat, not already handled by
 * something it was pressed in (an open menu closes on Escape and says so
 * by preventing it), and not in a form control or a dialog, which keep their
 * keys. A checkbox types nothing, so `inCheckboxes` lets the key through there.
 */
export const isShortcut = ({ event, key, inCheckboxes = false }: IsShortcutProps): boolean =>
  event.key.toLowerCase() === key &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.altKey &&
  !event.repeat &&
  !event.defaultPrevented &&
  (!isTypingTarget(event.target) || (inCheckboxes && isCheckbox(event.target))) &&
  !(event.target instanceof Element && event.target.closest('dialog'))

type UseKeyShortcutProps = {
  key: string
  onPress: () => void
  inCheckboxes?: boolean
}

/** Calls `onPress` whenever `key` is pressed as a shortcut anywhere on the page. */
export const useKeyShortcut = ({
  key,
  onPress,
  inCheckboxes = false,
}: UseKeyShortcutProps): void => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isShortcut({ event, key, inCheckboxes })) return
      event.preventDefault()
      onPress()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [key, onPress, inCheckboxes])
}
