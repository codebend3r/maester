import { type RefObject, useEffect, useRef } from 'react'

/**
 * Hands focus back to `target` once the modal it opened has closed. The open
 * dialog makes everything behind it inert, so focus can only come back once
 * it has unmounted.
 */
export const useReturnFocus = ({
  isOpen,
  target,
}: {
  isOpen: boolean
  target: RefObject<HTMLElement | null>
}): void => {
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !isOpen) target.current?.focus()
    wasOpen.current = isOpen
  }, [isOpen, target])
}
