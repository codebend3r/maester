import { create } from 'zustand'

/**
 * The card another screen was opened from, by its place on this one. It lasts through the
 * screen being covered once, so the card can take the focus back as the screen returns.
 */
type Opener = { card: string; wasCovered: boolean }

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
  change({ screen, to: { hasSettled: true, opener: { card, wasCovered: false } } })

/** Hands the opener back once, and only to the card it names: true for that card, then never. */
export const takeOpener = ({ screen, card }: { screen: string; card: string }): boolean => {
  if (openerOf({ screen })?.card !== card) return false
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
  change({ screen, to: { opener: opener.wasCovered ? null : { ...opener, wasCovered: true } } })
}

/** Forgets a screen that has gone, so one opened in its place starts afresh. */
export const leaveScreen = ({ screen }: { screen: string }): void =>
  useScreenFocus.setState((state) => ({
    screens: Object.fromEntries(Object.entries(state.screens).filter(([key]) => key !== screen)),
  }))
