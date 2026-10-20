import { useIsFocused, useRoute } from 'expo-router'
import { type RefObject, useEffect, useRef } from 'react'

import { requestTVFocus } from '@/layouts/tvFocus'
import {
  coverScreen,
  isOpeningIn,
  leaveScreen,
  rememberOpener,
  settleScreen,
  takeOpener,
  useScreenFocus,
} from '@/stores/screenFocus'

/**
 * Calls `onTurn` each time the screen turns to the front (`toFront`), once another on top of it
 * has gone, or away from it, as another covers it: never as it mounts, and never while it stays
 * where it is.
 */
const useScreenTurn = ({ toFront, onTurn }: { toFront: boolean; onTurn: () => void }): void => {
  const isFocused = useIsFocused()
  const wasFocused = useRef(isFocused)
  useEffect(() => {
    if (isFocused === toFront && wasFocused.current !== toFront) onTurn()
    wasFocused.current = isFocused
  }, [isFocused, toFront, onTurn])
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
 * opening focus, and as another screen covers it, an opener no card took when it last came back
 * let go, so no later return asks for it. The screen's focus is forgotten with the layout.
 */
export const useScreenFocusScope = (): OpeningFocus => {
  const screen = useRoute().key
  useScreenTurn({ toFront: false, onTurn: () => coverScreen({ screen }) })
  // A layout that takes another's place on the same route (Home's, on a server switch) first
  // draws with the entry it leaves, and again with a fresh one once this forgets it.
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
  useScreenTurn({
    toFront: true,
    onTurn: () => {
      if (takeOpener({ screen, card: place })) requestTVFocus(view.current)
    },
  })
  return { remember: () => rememberOpener({ screen, card: place }) }
}
