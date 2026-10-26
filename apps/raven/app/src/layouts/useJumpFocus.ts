import { type RefObject, useEffect } from 'react'

import { requestTVFocus } from '@/layouts/tvFocus'

/** A jump that landed on a card: its count, and the grid's way to mark that count handled. */
export type JumpFocus = { count: number; claim: (count: number) => boolean }

type UseJumpFocusProps = {
  jump: JumpFocus | null
  view: RefObject<unknown>
}

/**
 * Asks for the remote's focus for the view `view` holds once per jump that lands on it. The
 * grid's `claim` answers true only for a count newer than any handled, so a card mounting
 * afresh later (scrolled back to, its bucket reopened, the grid sorted again) asks nothing.
 */
export const useJumpFocus = ({ jump, view }: UseJumpFocusProps): void => {
  useEffect(() => {
    if (jump !== null && jump.claim(jump.count)) requestTVFocus(view.current)
  }, [jump, view])
}
