import { create } from 'zustand'

/** The phases of taking the focus back to the card a screen was opened from. */
export const RESTORE_PHASES = {
  none: 'none',
  opener: 'opener',
  returning: 'returning',
  asked: 'asked',
} as const

type RestorePhase = (typeof RESTORE_PHASES)[keyof typeof RESTORE_PHASES]

/** The card another screen was opened from: its place on this one, and the shelf it sits on, if any. */
type RestoredCard = { card: string; shelf: string | null }

/**
 * Where a screen stands in taking the focus back, as a TV screen comes back to the front:
 * - `none`: nothing to take it back to.
 * - `opener`: a card opened another screen. It lasts through the screen being covered once,
 *   so the card can take the focus back as the screen returns; `isDrawn` says whether its view
 *   is still there, since its shelf can go while the screen is covered; `hasTransitionEnded`
 *   says the transition that brought the screen back ended before any card took it, as a native
 *   pop (tvOS's Menu) tells the navigator of itself only as its animation ends.
 * - `returning`: the card took the opener as the screen came to the front, and asks for the
 *   focus; it asks again when the transition that reveals the screen ends, since the transition
 *   can take the focus from a view that asked before then: on Android TV always, on tvOS now
 *   and then, when the remote lands on the screen's first control instead.
 * - `asked`: the transition has ended, and the card is asked to take the focus again now.
 */
type Restore =
  | { kind: typeof RESTORE_PHASES.none }
  | (RestoredCard & {
      kind: typeof RESTORE_PHASES.opener
      isDrawn: boolean
      hasBeenCovered: boolean
      hasTransitionEnded: boolean
    })
  | (RestoredCard & { kind: typeof RESTORE_PHASES.returning })
  | (RestoredCard & { kind: typeof RESTORE_PHASES.asked })

/** What one screen keeps of the remote's focus, on a TV. */
type ScreenFocus = {
  /** Whether anything on the screen has had the focus, which spends its opening focus. */
  hasSettled: boolean
  restore: Restore
}

type ScreenFocusState = { screens: Readonly<Record<string, ScreenFocus>> }

/**
 * Each screen's focus, by its route's key. The layout and every card on a screen read it, so
 * it lives here rather than in any one of them.
 */
export const useScreenFocus = create<ScreenFocusState>()(() => ({ screens: {} }))

const NOTHING: Restore = { kind: RESTORE_PHASES.none }

const FRESH: ScreenFocus = { hasSettled: false, restore: NOTHING }

type ScreenOfProps = { state: ScreenFocusState; screen: string }

const screenOf = ({ state, screen }: ScreenOfProps): ScreenFocus => state.screens[screen] ?? FRESH

type RestoreOfProps = { screen: string }

const restoreNow = ({ screen }: RestoreOfProps): Restore =>
  screenOf({ state: useScreenFocus.getState(), screen }).restore

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

type RememberOpenerProps = { screen: string } & RestoredCard

/** The card at `card` opens another screen; it takes the focus back when this one returns. */
export const rememberOpener = ({ screen, card, shelf }: RememberOpenerProps): void =>
  change({
    screen,
    to: {
      hasSettled: true,
      restore: {
        kind: RESTORE_PHASES.opener,
        card,
        shelf,
        isDrawn: true,
        hasBeenCovered: false,
        hasTransitionEnded: false,
      },
    },
  })

type DrawCardProps = {
  screen: string
  card: string
  isDrawn: boolean
}

/** The card at `card` is drawn, or goes (`isDrawn`); only the opener's own card counts. */
export const drawCard = ({ screen, card, isDrawn }: DrawCardProps): void => {
  const restore = restoreNow({ screen })
  if (restore.kind !== RESTORE_PHASES.opener || restore.card !== card) return
  if (restore.isDrawn === isDrawn) return
  change({ screen, to: { restore: { ...restore, isDrawn } } })
}

type TakeOpenerProps = { screen: string; card: string }

/**
 * Hands the opener to the card it names, once, as the screen comes to the front: the card is
 * returning until the transition ends, when it is asked again, or asked at once after a
 * transition that ended before the card took it.
 */
export const takeOpener = ({ screen, card }: TakeOpenerProps): void => {
  const restore = restoreNow({ screen })
  if (restore.kind !== RESTORE_PHASES.opener || restore.card !== card) return
  const taken = { card, shelf: restore.shelf }
  change({
    screen,
    to: {
      restore: restore.hasTransitionEnded
        ? { kind: RESTORE_PHASES.asked, ...taken }
        : { kind: RESTORE_PHASES.returning, ...taken },
    },
  })
}

type CoverScreenProps = { screen: string }

/**
 * Another screen covers this one. The opener just remembered lasts through it; one that has
 * lasted through a cover already, which no card took as the screen came back, goes, so a
 * return from a screen no card opened asks for nothing. A card returning or asked is done.
 */
export const coverScreen = ({ screen }: CoverScreenProps): void => {
  const restore = restoreNow({ screen })
  switch (restore.kind) {
    case RESTORE_PHASES.none:
      return
    case RESTORE_PHASES.opener:
      change({
        screen,
        to: {
          restore: restore.hasBeenCovered
            ? NOTHING
            : { ...restore, hasBeenCovered: true, hasTransitionEnded: false },
        },
      })
      return
    case RESTORE_PHASES.returning:
    case RESTORE_PHASES.asked:
      change({ screen, to: { restore: NOTHING } })
      return
    default: {
      const unknown: never = restore
      return unknown
    }
  }
}

type ReturnScreenProps = { screen: string }

/**
 * The transition that brings the screen back to the front has ended (the navigator's
 * `transitionEnd`, which `AppRoot` hears). The card returning is asked to take the focus again
 * now, since on Android TV the transition takes the focus from anything asked for before then.
 * An opener no card has taken yet keeps that the transition has ended, so the card asks as it
 * takes it. An opener whose card is no longer drawn (its shelf went while the screen was
 * covered) has nothing to take the focus back to, so the screen gives its opening focus again
 * rather than leave the remote on nothing, as Android TV would.
 */
export const returnScreen = ({ screen }: ReturnScreenProps): void => {
  const restore = restoreNow({ screen })
  switch (restore.kind) {
    case RESTORE_PHASES.none:
    case RESTORE_PHASES.asked:
      return
    case RESTORE_PHASES.returning:
      change({
        screen,
        to: { restore: { kind: RESTORE_PHASES.asked, card: restore.card, shelf: restore.shelf } },
      })
      return
    case RESTORE_PHASES.opener:
      change({
        screen,
        to: restore.isDrawn
          ? { restore: { ...restore, hasTransitionEnded: true } }
          : { hasSettled: false, restore: NOTHING },
      })
      return
    default: {
      const unknown: never = restore
      return unknown
    }
  }
}

type RestoreInProps = { state: ScreenFocusState; screen: string }

/** Where the screen stands in taking the focus back. */
export const restoreIn = ({ state, screen }: RestoreInProps): Restore =>
  screenOf({ state, screen }).restore

/** The card taking the focus back, from the screen's return until it has asked; null in any other phase. */
export const restoringCardOf = (restore: Restore): RestoredCard | null =>
  restore.kind === RESTORE_PHASES.returning || restore.kind === RESTORE_PHASES.asked
    ? { card: restore.card, shelf: restore.shelf }
    : null

type IsCardInPhaseProps = RestoreInProps & { card: string; phase: RestorePhase }

/** Whether the card at `card` is the one in the phase `phase` of taking the focus back. */
export const isCardInPhase = ({ state, screen, card, phase }: IsCardInPhaseProps): boolean => {
  const restore = restoreIn({ state, screen })
  return restore.kind === phase && restore.kind !== RESTORE_PHASES.none && restore.card === card
}

type SpendAskProps = { screen: string }

/** The card asked has asked, so one drawn afresh later does not ask again. */
export const spendAsk = ({ screen }: SpendAskProps): void => {
  if (restoreNow({ screen }).kind === RESTORE_PHASES.asked)
    change({ screen, to: { restore: NOTHING } })
}

type LeaveScreenProps = { screen: string }

/** Forgets a screen that has gone, so one opened in its place starts afresh. */
export const leaveScreen = ({ screen }: LeaveScreenProps): void =>
  useScreenFocus.setState((state) => ({
    screens: Object.fromEntries(Object.entries(state.screens).filter(([key]) => key !== screen)),
  }))
