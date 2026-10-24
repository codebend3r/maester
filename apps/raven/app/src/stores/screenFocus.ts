import { create } from 'zustand'

/**
 * The card another screen was opened from, by its place on this one, and whether that card is
 * drawn: its shelf can go while the screen is covered. It lasts through the screen being covered
 * once, so the card can take the focus back as the screen returns.
 */
type Opener = { card: string; isDrawn: boolean; hasBeenCovered: boolean }

/** What one screen keeps of the remote's focus, on a TV. */
type ScreenFocus = {
  /** Whether anything on the screen has had the focus, which spends its opening focus. */
  hasSettled: boolean
  opener: Opener | null
}

type ScreenFocusState = { screens: Readonly<Record<string, ScreenFocus>> }

/**
 * Each screen's focus, by its route's key. The layout and every card on a screen read it, so
 * it lives here rather than in any one of them.
 */
export const useScreenFocus = create<ScreenFocusState>()(() => ({ screens: {} }))

const FRESH: ScreenFocus = { hasSettled: false, opener: null }

const screenOf = ({ state, screen }: { state: ScreenFocusState; screen: string }): ScreenFocus =>
  state.screens[screen] ?? FRESH

const openerOf = ({ screen }: { screen: string }): Opener | null =>
  screenOf({ state: useScreenFocus.getState(), screen }).opener

const change = ({ screen, to }: { screen: string; to: Partial<ScreenFocus> }): void =>
  useScreenFocus.setState((state) => ({
    screens: { ...state.screens, [screen]: { ...screenOf({ state, screen }), ...to } },
  }))

/** Whether the screen still gives its opening focus: nothing on it has had the focus yet. */
export const isOpeningIn = ({ state, screen }: { state: ScreenFocusState; screen: string }) =>
  !screenOf({ state, screen }).hasSettled

/** Something on the screen has the focus: its opening focus is spent. */
export const settleScreen = ({ screen }: { screen: string }): void => {
  if (isOpeningIn({ state: useScreenFocus.getState(), screen }))
    change({ screen, to: { hasSettled: true } })
}

/** The card at `card` opens another screen; it takes the focus back when this one returns. */
export const rememberOpener = ({ screen, card }: { screen: string; card: string }): void =>
  change({
    screen,
    to: { hasSettled: true, opener: { card, isDrawn: true, hasBeenCovered: false } },
  })

/** The card at `card` is drawn, or goes (`isDrawn`); only the opener's own card counts. */
export const drawCard = ({
  screen,
  card,
  isDrawn,
}: {
  screen: string
  card: string
  isDrawn: boolean
}): void => {
  const opener = openerOf({ screen })
  if (opener === null || opener.card !== card || opener.isDrawn === isDrawn) return
  change({ screen, to: { opener: { ...opener, isDrawn } } })
}

/** Hands the opener back once, and only to the card it names: true for that card, then never. */
export const takeOpener = ({ screen, card }: { screen: string; card: string }): boolean => {
  if ((openerOf({ screen })?.card ?? null) !== card) return false
  change({ screen, to: { opener: null } })
  return true
}

/**
 * Another screen covers this one. The opener just remembered lasts through it; one that has
 * lasted through a cover already, which no card took as the screen came back, goes, so a
 * return from a screen no card opened asks for nothing.
 */
export const coverScreen = ({ screen }: { screen: string }): void => {
  const opener = openerOf({ screen })
  if (opener === null) return
  change({
    screen,
    to: { opener: opener.hasBeenCovered ? null : { ...opener, hasBeenCovered: true } },
  })
}

/**
 * The transition that brings the screen back to the front has ended (the navigator's
 * `transitionEnd`, which `AppRoot` hears). An opener whose card is no longer drawn (its shelf
 * went while the screen was covered) has nothing to take the focus back to, so the screen gives
 * its opening focus again rather than leave the remote on nothing, as Android TV would. It waits
 * for the transition's end, since on Android TV the transition takes the focus from anything
 * asked for before then.
 */
export const returnScreen = ({ screen }: { screen: string }): void => {
  const opener = openerOf({ screen })
  if (opener === null || opener.isDrawn) return
  change({ screen, to: { hasSettled: false, opener: null } })
}

/** Forgets a screen that has gone, so one opened in its place starts afresh. */
export const leaveScreen = ({ screen }: { screen: string }): void =>
  useScreenFocus.setState((state) => ({
    screens: Object.fromEntries(Object.entries(state.screens).filter(([key]) => key !== screen)),
  }))
