import { useIsFocused, useRoute } from 'expo-router'
import { type RefObject, useEffect, useRef } from 'react'

import { requestTVFocus } from '@/layouts/tvFocus'
import {
  coverScreen,
  drawCard,
  isOpeningIn,
  leaveScreen,
  rememberOpener,
  settleScreen,
  takeOpener,
  useScreenFocus,
} from '@/stores/screenFocus'

/**
 * Calls `onTurn` each time the screen turns to the front (`isToFront`), once another on top of it
 * has gone, or away from it, as another covers it: never as it mounts, and never while it stays
 * where it is.
 */
const useScreenTurn = ({ isToFront, onTurn }: { isToFront: boolean; onTurn: () => void }): void => {
  const isFocused = useIsFocused()
  const isFocusedBefore = useRef(isFocused)
  useEffect(() => {
    if (isFocused === isToFront && isFocusedBefore.current !== isToFront) onTurn()
    isFocusedBefore.current = isFocused
  }, [isFocused, isToFront, onTurn])
}

/**
 * Asks the remote's focus for the view `view` holds once, as it is drawn, when `isAsked` was
 * true then. A view that mounts asking through `hasTVPreferredFocus` asks before it is in the
 * window, and the fork retries that only once, which on Android TV is still too early: the
 * screen opened with nothing focused.
 */
export const useFocusOnMount = ({
  view,
  isAsked = true,
}: {
  view: RefObject<unknown>
  isAsked?: boolean
}): void => {
  const isAskedOnMount = useRef(isAsked)
  useEffect(() => {
    if (isAskedOnMount.current) requestTVFocus(view.current)
  }, [view])
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
  useScreenTurn({ isToFront: false, onTurn: () => coverScreen({ screen }) })
  // A layout that takes another's place on the same route (Home's, on a server switch) first
  // draws with the entry it leaves, and again with a fresh one once this forgets it.
  useEffect(() => () => leaveScreen({ screen }), [screen])
  return useOpeningFocus()
}

/**
 * A card's part in taking the focus back to the card another screen was opened from. The card
 * calls `remember` as it opens one; when this screen returns, the card remembered asks for the
 * remote's focus once, whether its view lived on under the screen on top or mounted afresh
 * there; it says as it is drawn and as it goes, so a return whose card has gone gives the
 * screen's opening focus instead. `place` is the card's place on its screen, unique there.
 */
export const useOpenerFocus = ({
  place,
  view,
}: {
  place: string
  view: RefObject<unknown>
}): { remember: () => void } => {
  const screen = useRoute().key
  useEffect(() => {
    drawCard({ screen, card: place, isDrawn: true })
    return () => drawCard({ screen, card: place, isDrawn: false })
  }, [screen, place])
  useScreenTurn({
    isToFront: true,
    onTurn: () => {
      if (takeOpener({ screen, card: place })) requestTVFocus(view.current)
    },
  })
  return { remember: () => rememberOpener({ screen, card: place }) }
}
