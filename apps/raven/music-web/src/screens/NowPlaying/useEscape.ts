import { useEffect } from 'react'

const KEY_EVENTS = { keydown: 'keydown' } as const

const KEYS = { escape: 'Escape' } as const

type UseEscapeProps = {
  onEscape: () => void
  /** Whether Escape is this screen's: not while a dialog over it takes the key to close itself. */
  isEnabled: boolean
}

/** Escape as the way out of a screen that covers everything, as it is of a dialog. */
export const useEscape = ({ onEscape, isEnabled }: UseEscapeProps): void => {
  useEffect(() => {
    if (!isEnabled) return undefined
    const listen = (event: KeyboardEvent) => {
      if (event.key !== KEYS.escape || event.defaultPrevented) return
      onEscape()
    }
    window.addEventListener(KEY_EVENTS.keydown, listen)
    return () => window.removeEventListener(KEY_EVENTS.keydown, listen)
  }, [onEscape, isEnabled])
}
