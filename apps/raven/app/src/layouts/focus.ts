import { useIsFocused, useRoute } from 'expo-router'
import { type RefObject, useEffect, useRef } from 'react'
import type { LayoutChangeEvent } from 'react-native'

import { requestTVFocus } from '@/layouts/tvFocus'
import {
  RESTORE_PHASES,
  coverScreen,
  drawCard,
  isCardInPhase,
  isOpeningIn,
  leaveScreen,
  rememberOpener,
  settleScreen,
  spendAsk,
  takeOpener,
  useScreenFocus,
} from '@/stores/screenFocus'
import { forgetShelf, placeShelf } from '@/stores/shelfBands'

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

type UseReturnAsksProps = {
  screen: string | null
  card: string
  view: RefObject<unknown>
}

/**
 * How long after the transition ends a returning card asks a last time. On tvOS an ask as the
 * transition ends can still be refused, and the focus engine then gives the remote to the
 * screen's top left control (Home's Search): under Home's hero, the card the screen was opened
 * from can sit at the foot of the screen, below a Continue watching row added while it was
 * covered, until the shelves settle. Home's shelves also bring the card's shelf into view as it
 * asks (`Shelf.focus`), since the engine refuses a view the shelves clip.
 */
const LAST_ASK_MS = 400

/**
 * The asks of the card the screen `screen` names as taking the focus back: once as it is
 * returning, again as the transition that brings the screen back ends (`asked`), and a last
 * time `LAST_ASK_MS` later, for tvOS, whose engine can refuse that one too. Each follows the
 * store's word in an effect, so a layout that reads the same word in a layout effect (Home's
 * shelves, which bring the card's shelf into view) acts before it.
 */
export const useReturnAsks = ({ screen, card, view }: UseReturnAsksProps): void => {
  const isReturning = useScreenFocus(
    (state) =>
      screen !== null && isCardInPhase({ state, screen, card, phase: RESTORE_PHASES.returning }),
  )
  const isAsked = useScreenFocus(
    (state) =>
      screen !== null && isCardInPhase({ state, screen, card, phase: RESTORE_PHASES.asked }),
  )
  const lastAsk = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (lastAsk.current !== null) clearTimeout(lastAsk.current)
    },
    [],
  )
  useEffect(() => {
    if (isReturning) requestTVFocus(view.current)
  }, [isReturning, view])
  useEffect(() => {
    if (screen === null || !isAsked) return
    spendAsk({ screen })
    requestTVFocus(view.current)
    // Kept past `isAsked` turning false, which spending the ask does at once; cleared only as the view goes.
    lastAsk.current = setTimeout(() => requestTVFocus(view.current), LAST_ASK_MS)
  }, [isAsked, screen, view])
}

type UseOpenerFocusProps = {
  /** The card's place on its screen, unique there. */
  place: string
  /** The shelf the card sits on, for the layout to bring into view as the card takes the focus back; none off a shelf. */
  shelf?: string | null
  view: RefObject<unknown>
}

/**
 * A card's part in taking the focus back to the card another screen was opened from. The card
 * calls `remember` as it opens one; when this screen returns, the card remembered takes the
 * opener and asks for the remote's focus, whether its view lived on under the screen on top or
 * mounted afresh there; it says as it is drawn and as it goes, so a return whose card has gone
 * gives the screen's opening focus instead.
 */
export const useOpenerFocus = ({
  place,
  shelf = null,
  view,
}: UseOpenerFocusProps): { remember: () => void } => {
  const screen = useRoute().key
  useEffect(() => {
    drawCard({ screen, card: place, isDrawn: true })
    return () => drawCard({ screen, card: place, isDrawn: false })
  }, [screen, place])
  useScreenTurn({ isToFront: true, onTurn: () => takeOpener({ screen, card: place }) })
  useReturnAsks({ screen, card: place, view })
  return { remember: () => rememberOpener({ screen, card: place, shelf }) }
}

/** What a shelf gives its root view to say where it stands. */
type ShelfBandHandlers = { onLayout: (event: LayoutChangeEvent) => void }

/**
 * A shelf's part in bringing itself into view as a card on it takes the focus back: it says
 * where it stands on its screen, under the key `shelf` its cards name, as it is laid out, and
 * forgets it as it goes.
 */
export const useShelfBand = (shelf: string): ShelfBandHandlers => {
  const screen = useRoute().key
  useEffect(() => () => forgetShelf({ screen, shelf }), [screen, shelf])
  return {
    onLayout: ({ nativeEvent: { layout } }) =>
      placeShelf({ screen, shelf, band: { top: layout.y, height: layout.height } }),
  }
}
