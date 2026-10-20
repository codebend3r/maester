import { useIsFocused, useRoute } from 'expo-router'
import { type RefObject, useEffect, useRef } from 'react'

import { requestTVFocus } from '@/layouts/tvFocus'
import {
  dropOpener,
  isOpeningIn,
  leaveScreen,
  rememberOpener,
  settleScreen,
  takeOpener,
  useScreenFocus,
} from '@/stores/screenFocus'

/**
 * Calls `onReturn` each time the screen comes back to the front, once another on top of it has
 * gone: never as it mounts, and never while it stays in front. Effects run children first, so
 * every card on a screen hears the return before the screen's layout does.
 */
const useScreenReturn = ({ onReturn }: { onReturn: () => void }): void => {
  const isFocused = useIsFocused()
  const wasFocused = useRef(isFocused)
  useEffect(() => {
    if (isFocused && !wasFocused.current) onReturn()
    wasFocused.current = isFocused
  }, [isFocused, onReturn])
}

/** Whether the screen still gives its opening focus, and the way to say something has had it. */
type OpeningFocus = { isOpening: boolean; settle: () => void }

/**
 * The screen's opening focus, which any part of its TV layout may read: `isOpening` is true
 * until anything on the screen has had the focus, and `settle` says something has.
 */
export const useOpeningFocus = (): OpeningFocus => {
  const screen = useRoute().key
  const isOpening = useScreenFocus((state) => isOpeningIn({ state, screen }))
  return { isOpening, settle: () => settleScreen({ screen }) }
}

/**
 * A TV layout's hold on its screen's focus, taken once per screen by its outermost layout: its
 * opening focus, and once the screen returns, after its cards have had their turn, an opener
 * none of them took let go, so no later return asks for it. The screen's focus is forgotten
 * with the layout.
 */
export const useScreenFocusScope = (): OpeningFocus => {
  const screen = useRoute().key
  useScreenReturn({ onReturn: () => dropOpener({ screen }) })
  useEffect(() => () => leaveScreen({ screen }), [screen])
  return useOpeningFocus()
}

/**
 * A card's part in taking the focus back to the card another screen was opened from. The card
 * calls `remember` as it opens one; when this screen returns, the card remembered asks for the
 * remote's focus once, whether its view lived on under the screen on top or mounted afresh
 * there. `place` is the card's place on its screen, unique there.
 */
export const useOpenerFocus = ({
  place,
  view,
}: {
  place: string
  view: RefObject<unknown>
}): { remember: () => void } => {
  const screen = useRoute().key
  useScreenReturn({
    onReturn: () => {
      if (takeOpener({ screen, card: place })) requestTVFocus(view.current)
    },
  })
  return { remember: () => rememberOpener({ screen, card: place }) }
}
