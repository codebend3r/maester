import { useEffect } from 'react'

/** Form controls keep their own keys: what is typed, a radio's arrows, a slider's. */
export const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && !!target.closest('input, select, textarea')

/**
 * Whether a press is `key` on its own, whatever its case: no Ctrl, Cmd or
 * Alt (those belong to the browser), no auto-repeat, and not in a form
 * control or a dialog, which keep their keys.
 */
export const isShortcut = ({ event, key }: { event: KeyboardEvent; key: string }): boolean =>
  event.key.toLowerCase() === key &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.altKey &&
  !event.repeat &&
  !isTypingTarget(event.target) &&
  !(event.target instanceof Element && event.target.closest('dialog'))

/** Calls `onPress` whenever `key` is pressed as a shortcut anywhere on the page. */
export const useKeyShortcut = ({ key, onPress }: { key: string; onPress: () => void }): void => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isShortcut({ event, key })) return
      event.preventDefault()
      onPress()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [key, onPress])
}
