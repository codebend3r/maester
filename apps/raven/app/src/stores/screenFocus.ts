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
  /**
   * The card that took the opener as the screen came to the front. It asks for the focus once
   * more when the transition that reveals the screen ends, since the transition can take the
   * focus from a view that asked before then: on Android TV always, on tvOS now and then, when
   * the remote lands on the screen's first control instead.
   */
  returning: string | null
  /** The card asked to take the focus again now that the transition has ended. */
  asked: string | null
}

type ScreenFocusState = { screens: Readonly<Record<string, ScreenFocus>> }

/**
 * Each screen's focus, by its route's key. The layout and every card on a screen read it, so
 * it lives here rather than in any one of them.
 */
export const useScreenFocus = create<ScreenFocusState>()(() => ({ screens: {} }))

const FRESH: ScreenFocus = { hasSettled: false, opener: null, returning: null, asked: null }

type ScreenOfProps = { state: ScreenFocusState; screen: string }

const screenOf = ({ state, screen }: ScreenOfProps): ScreenFocus => state.screens[screen] ?? FRESH

type OpenerOfProps = { screen: string }

const openerOf = ({ screen }: OpenerOfProps): Opener | null =>
  screenOf({ state: useScreenFocus.getState(), screen }).opener

type ChangeProps = { screen: string; to: Partial<ScreenFocus> }

const change = ({ screen, to }: ChangeProps): void =>
  useScreenFocus.setState((state) => ({
    screens: { ...state.screens, [screen]: { ...screenOf({ state, screen }), ...to } },
  }))

type IsOpeningInProps = { state: ScreenFocusState; screen: string }

/** Whether the screen still gives its opening focus: nothing on it has had the focus yet. */
export const isOpeningIn = ({ state, screen }: IsOpeningInProps) =>
  !screenOf({ state, screen }).hasSettled

type SettleScreenProps = { screen: string }

/** Something on the screen has the focus: its opening focus is spent. */
export const settleScreen = ({ screen }: SettleScreenProps): void => {
  if (isOpeningIn({ state: useScreenFocus.getState(), screen }))
    change({ screen, to: { hasSettled: true } })
}

type RememberOpenerProps = { screen: string; card: string }

/** The card at `card` opens another screen; it takes the focus back when this one returns. */
export const rememberOpener = ({ screen, card }: RememberOpenerProps): void =>
  change({
    screen,
    to: { hasSettled: true, opener: { card, isDrawn: true, hasBeenCovered: false } },
  })

type DrawCardProps = {
  screen: string
  card: string
  isDrawn: boolean
}

/** The card at `card` is drawn, or goes (`isDrawn`); only the opener's own card counts. */
export const drawCard = ({ screen, card, isDrawn }: DrawCardProps): void => {
  const opener = openerOf({ screen })
  if (opener === null || opener.card !== card || opener.isDrawn === isDrawn) return
  change({ screen, to: { opener: { ...opener, isDrawn } } })
}

type TakeOpenerProps = { screen: string; card: string }

/** Hands the opener back once, and only to the card it names: true for that card, then never. */
export const takeOpener = ({ screen, card }: TakeOpenerProps): boolean => {
  if ((openerOf({ screen })?.card ?? null) !== card) return false
  change({ screen, to: { opener: null, returning: card } })
  return true
}

type CoverScreenProps = { screen: string }

/**
 * Another screen covers this one. The opener just remembered lasts through it; one that has
 * lasted through a cover already, which no card took as the screen came back, goes, so a
 * return from a screen no card opened asks for nothing.
 */
export const coverScreen = ({ screen }: CoverScreenProps): void => {
  const { opener, returning, asked } = screenOf({ state: useScreenFocus.getState(), screen })
  if (opener === null && returning === null && asked === null) return
  const kept = opener === null || opener.hasBeenCovered ? null : { ...opener, hasBeenCovered: true }
  change({ screen, to: { opener: kept, returning: null, asked: null } })
}

type ReturnScreenProps = { screen: string }

/**
 * The transition that brings the screen back to the front has ended (the navigator's
 * `transitionEnd`, which `AppRoot` hears). An opener whose card is no longer drawn (its shelf
 * went while the screen was covered) has nothing to take the focus back to, so the screen gives
 * its opening focus again rather than leave the remote on nothing, as Android TV would. It waits
 * for the transition's end, since on Android TV the transition takes the focus from anything
 * asked for before then. The card that took the focus back as the screen came to the front
 * asks for it again now, for the same reason.
 */
export const returnScreen = ({ screen }: ReturnScreenProps): void => {
  const { opener, returning } = screenOf({ state: useScreenFocus.getState(), screen })
  if (returning !== null) {
    change({ screen, to: { returning: null, asked: returning } })
    return
  }
  if (opener === null || opener.isDrawn) return
  change({ screen, to: { hasSettled: false, opener: null } })
}

type IsAskedInProps = { state: ScreenFocusState; screen: string; card: string }

/** Whether the card at `card` is asked to take the focus again. */
export const isAskedIn = ({ state, screen, card }: IsAskedInProps): boolean =>
  screenOf({ state, screen }).asked === card

type SpendAskProps = { screen: string }

/** The card asked has asked, so one drawn afresh later does not ask again. */
export const spendAsk = ({ screen }: SpendAskProps): void => change({ screen, to: { asked: null } })

type LeaveScreenProps = { screen: string }

/** Forgets a screen that has gone, so one opened in its place starts afresh. */
export const leaveScreen = ({ screen }: LeaveScreenProps): void =>
  useScreenFocus.setState((state) => ({
    screens: Object.fromEntries(Object.entries(state.screens).filter(([key]) => key !== screen)),
  }))
