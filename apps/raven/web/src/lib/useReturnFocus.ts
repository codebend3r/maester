import { type RefObject, useEffect, useRef } from 'react'

type UseReturnFocusProps = {
  isOpen: boolean
  target: RefObject<HTMLElement | null>
}

/**
 * Hands focus back to `target` once the modal it opened has closed. The open
 * dialog makes everything behind it inert, so focus can only come back once
 * it has unmounted.
 */
export const useReturnFocus = ({ isOpen, target }: UseReturnFocusProps): void => {
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !isOpen) target.current?.focus()
    wasOpen.current = isOpen
  }, [isOpen, target])
}
