import { useIsFocused, useRoute } from 'expo-router'
import { type RefObject, useEffect, useRef } from 'react'

import { requestTVFocus } from '@/layouts/tvFocus'
import {
  coverScreen,
  drawCard,
  isAskedIn,
  isOpeningIn,
  leaveScreen,
  rememberOpener,
  settleScreen,
  spendAsk,
  takeOpener,
  useScreenFocus,
} from '@/stores/screenFocus'

type UseScreenTurnProps = { isToFront: boolean; onTurn: () => void }

/**
 * Calls `onTurn` each time the screen turns to the front (`isToFront`), once another on top of it
 * has gone, or away from it, as another covers it: never as it mounts, and never while it stays
 * where it is.
 */
const useScreenTurn = ({ isToFront, onTurn }: UseScreenTurnProps): void => {
  const isFocused = useIsFocused()
  const isFocusedBefore = useRef(isFocused)
  useEffect(() => {
    if (isFocused === isToFront && isFocusedBefore.current !== isToFront) onTurn()
    isFocusedBefore.current = isFocused
  }, [isFocused, isToFront, onTurn])
}

type UseFocusOnMountProps = {
  view: RefObject<unknown>
  isAsked?: boolean
}

/**
 * Asks the remote's focus for the view `view` holds once, as it is drawn, when `isAsked` was
 * true then. A view that mounts asking through `hasTVPreferredFocus` asks before it is in the
 * window, and the fork retries that only once, which on Android TV is still too early: the
 * screen opened with nothing focused.
 */
export const useFocusOnMount = ({ view, isAsked = true }: UseFocusOnMountProps): void => {
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
  /*
   * A layout that takes another's place on the same route (Home's, on a server switch) first
   * draws with the entry it leaves, and again with a fresh one once this forgets it.
   */
  useEffect(() => () => leaveScreen({ screen }), [screen])
  return useOpeningFocus()
}

type UseAskedAgainProps = {
  screen: string | null
  card: string
  view: RefObject<unknown>
}

/**
 * How long after the transition ends a returning card asks a last time. On tvOS an ask as the
 * transition ends can still be refused, and the focus engine then gives the remote to the
 * screen's top left control (Home's Search): under Home's hero, the card the screen was opened
 * from can sit at the foot of the screen, below a Continue watching row added while it was
 * covered, until the shelves settle.
 */
const LAST_ASK_MS = 400

/**
 * Asks the remote's focus for the view `view` holds once more, when the screen `screen` names it
 * as the transition that brought the screen back ends: a card or the strip that took the focus
 * back as the screen came to the front, since the transition can take that first ask away. It
 * asks a last time `LAST_ASK_MS` later, for tvOS, whose engine can refuse that one too.
 */
export const useAskedAgain = ({ screen, card, view }: UseAskedAgainProps): void => {
  const isAsked = useScreenFocus((state) => screen !== null && isAskedIn({ state, screen, card }))
  const lastAsk = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (lastAsk.current !== null) clearTimeout(lastAsk.current)
    },
    [],
  )
  useEffect(() => {
    if (screen === null || !isAsked) return
    spendAsk({ screen })
    requestTVFocus(view.current)
    // Kept past `isAsked` turning false, which spending the ask does at once; cleared only as the view goes.
    lastAsk.current = setTimeout(() => requestTVFocus(view.current), LAST_ASK_MS)
  }, [isAsked, screen, view])
}

type UseOpenerFocusProps = {
  place: string
  view: RefObject<unknown>
}

/**
 * A card's part in taking the focus back to the card another screen was opened from. The card
 * calls `remember` as it opens one; when this screen returns, the card remembered asks for the
 * remote's focus once, whether its view lived on under the screen on top or mounted afresh
 * there; it says as it is drawn and as it goes, so a return whose card has gone gives the
 * screen's opening focus instead. It asks once more as the transition that brings the screen
 * back ends, which can take the first ask away. `place` is the card's place on its screen,
 * unique there.
 */
export const useOpenerFocus = ({ place, view }: UseOpenerFocusProps): { remember: () => void } => {
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
  useAskedAgain({ screen, card: place, view })
  return { remember: () => rememberOpener({ screen, card: place }) }
}
