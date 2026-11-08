import { beforeEach, describe, expect, it } from 'bun:test'

import {
  RESTORE_PHASES,
  coverScreen,
  drawCard,
  isCardInPhase,
  isOpeningIn,
  leaveScreen,
  rememberOpener,
  restoreIn,
  restoringCardOf,
  returnScreen,
  settleScreen,
  spendAsk,
  takeOpener,
  useScreenFocus,
} from '@/stores/screenFocus'

const HOME = 'home-route'
const ITEM = 'item-route'
const FILMS = 'library:1'
const NIGHT_TRAIN = 'library:1/media:3'
const BUSBOYS = 'library:1/media:2'

type PhaseOfProps = { screen: string; card: string }

/** Which phase the card is in, or none. */
const phaseOf = ({ screen, card }: PhaseOfProps) =>
  Object.values(RESTORE_PHASES).find(
    (phase) =>
      phase !== RESTORE_PHASES.none &&
      isCardInPhase({ state: useScreenFocus.getState(), screen, card, phase }),
  ) ?? RESTORE_PHASES.none

type RememberProps = { card: string; screen?: string }

const remember = ({ card, screen = HOME }: RememberProps) =>
  rememberOpener({ screen, card, shelf: FILMS })

describe('screen focus', () => {
  beforeEach(() => useScreenFocus.setState({ screens: {} }))

  it('keeps a screen opening until something on it has the focus', () => {
    expect(isOpeningIn({ state: useScreenFocus.getState(), screen: HOME })).toBe(true)
    settleScreen({ screen: HOME })
    expect(isOpeningIn({ state: useScreenFocus.getState(), screen: HOME })).toBe(false)
    expect(isOpeningIn({ state: useScreenFocus.getState(), screen: ITEM })).toBe(true)
  })

  it('hands the opener back once, and only to the card it names, with its shelf', () => {
    remember({ card: NIGHT_TRAIN })
    takeOpener({ screen: HOME, card: BUSBOYS })
    takeOpener({ screen: ITEM, card: NIGHT_TRAIN })
    expect(phaseOf({ screen: HOME, card: NIGHT_TRAIN })).toBe(RESTORE_PHASES.opener)
    takeOpener({ screen: HOME, card: NIGHT_TRAIN })
    expect(restoreIn({ state: useScreenFocus.getState(), screen: HOME })).toEqual({
      kind: RESTORE_PHASES.returning,
      card: NIGHT_TRAIN,
      shelf: FILMS,
    })
    takeOpener({ screen: HOME, card: NIGHT_TRAIN })
    expect(phaseOf({ screen: HOME, card: NIGHT_TRAIN })).toBe(RESTORE_PHASES.returning)
  })

  it('counts opening a card as having had the focus', () => {
    remember({ card: NIGHT_TRAIN })
    expect(isOpeningIn({ state: useScreenFocus.getState(), screen: HOME })).toBe(false)
  })

  it('keeps the opener through the cover the card opened, for the card to take on return', () => {
    remember({ card: NIGHT_TRAIN })
    coverScreen({ screen: HOME })
    takeOpener({ screen: HOME, card: NIGHT_TRAIN })
    expect(phaseOf({ screen: HOME, card: NIGHT_TRAIN })).toBe(RESTORE_PHASES.returning)
  })

  it('lets an opener no card took go as the screen is covered again', () => {
    remember({ card: NIGHT_TRAIN })
    coverScreen({ screen: HOME })
    coverScreen({ screen: HOME })
    takeOpener({ screen: HOME, card: NIGHT_TRAIN })
    expect(phaseOf({ screen: HOME, card: NIGHT_TRAIN })).toBe(RESTORE_PHASES.none)
    expect(isOpeningIn({ state: useScreenFocus.getState(), screen: HOME })).toBe(false)
  })

  it('keeps a new opener through its own cover, whatever the last one left', () => {
    remember({ card: NIGHT_TRAIN })
    coverScreen({ screen: HOME })
    remember({ card: BUSBOYS })
    coverScreen({ screen: HOME })
    takeOpener({ screen: HOME, card: BUSBOYS })
    expect(phaseOf({ screen: HOME, card: BUSBOYS })).toBe(RESTORE_PHASES.returning)
  })

  it('forgets a screen that has gone, so one opened in its place starts afresh', () => {
    remember({ card: NIGHT_TRAIN })
    remember({ card: BUSBOYS, screen: ITEM })
    leaveScreen({ screen: HOME })
    expect(useScreenFocus.getState().screens).toEqual({
      [ITEM]: {
        hasSettled: true,
        restore: {
          kind: RESTORE_PHASES.opener,
          card: BUSBOYS,
          shelf: FILMS,
          isDrawn: true,
          hasBeenCovered: false,
          hasTransitionEnded: false,
        },
      },
    })
    expect(isOpeningIn({ state: useScreenFocus.getState(), screen: HOME })).toBe(true)
  })

  it('opens a screen again on a return whose opener has gone, its shelf with it', () => {
    remember({ card: NIGHT_TRAIN })
    coverScreen({ screen: HOME })
    drawCard({ screen: HOME, card: NIGHT_TRAIN, isDrawn: false })
    returnScreen({ screen: HOME })
    expect(isOpeningIn({ state: useScreenFocus.getState(), screen: HOME })).toBe(true)
    takeOpener({ screen: HOME, card: NIGHT_TRAIN })
    expect(phaseOf({ screen: HOME, card: NIGHT_TRAIN })).toBe(RESTORE_PHASES.none)
  })

  it('leaves the opener to its card when the card was drawn afresh while covered', () => {
    remember({ card: NIGHT_TRAIN })
    coverScreen({ screen: HOME })
    drawCard({ screen: HOME, card: NIGHT_TRAIN, isDrawn: false })
    drawCard({ screen: HOME, card: NIGHT_TRAIN, isDrawn: true })
    returnScreen({ screen: HOME })
    expect(isOpeningIn({ state: useScreenFocus.getState(), screen: HOME })).toBe(false)
    takeOpener({ screen: HOME, card: NIGHT_TRAIN })
    expect(phaseOf({ screen: HOME, card: NIGHT_TRAIN })).toBe(RESTORE_PHASES.asked)
  })

  it("hears only the opener's own card come and go", () => {
    remember({ card: NIGHT_TRAIN })
    drawCard({ screen: HOME, card: BUSBOYS, isDrawn: false })
    drawCard({ screen: ITEM, card: NIGHT_TRAIN, isDrawn: false })
    returnScreen({ screen: HOME })
    takeOpener({ screen: HOME, card: NIGHT_TRAIN })
    expect(phaseOf({ screen: HOME, card: NIGHT_TRAIN })).toBe(RESTORE_PHASES.asked)
    expect(useScreenFocus.getState().screens[ITEM]).toBeUndefined()
  })

  it('asks the card that took the focus back to take it again as the transition ends', () => {
    remember({ card: NIGHT_TRAIN })
    coverScreen({ screen: HOME })
    takeOpener({ screen: HOME, card: NIGHT_TRAIN })
    expect(phaseOf({ screen: HOME, card: NIGHT_TRAIN })).toBe(RESTORE_PHASES.returning)
    returnScreen({ screen: HOME })
    expect(phaseOf({ screen: HOME, card: NIGHT_TRAIN })).toBe(RESTORE_PHASES.asked)
    expect(phaseOf({ screen: HOME, card: BUSBOYS })).toBe(RESTORE_PHASES.none)
    spendAsk({ screen: HOME })
    returnScreen({ screen: HOME })
    expect(phaseOf({ screen: HOME, card: NIGHT_TRAIN })).toBe(RESTORE_PHASES.none)
  })

  it('asks a card at once when the transition ended before it took the opener', () => {
    remember({ card: NIGHT_TRAIN })
    coverScreen({ screen: HOME })
    returnScreen({ screen: HOME })
    expect(phaseOf({ screen: HOME, card: NIGHT_TRAIN })).toBe(RESTORE_PHASES.opener)
    takeOpener({ screen: HOME, card: NIGHT_TRAIN })
    expect(phaseOf({ screen: HOME, card: NIGHT_TRAIN })).toBe(RESTORE_PHASES.asked)
    // The ended transition is spent with the ask: the next return waits for its own end again.
    spendAsk({ screen: HOME })
    remember({ card: NIGHT_TRAIN })
    coverScreen({ screen: HOME })
    takeOpener({ screen: HOME, card: NIGHT_TRAIN })
    expect(phaseOf({ screen: HOME, card: NIGHT_TRAIN })).toBe(RESTORE_PHASES.returning)
  })

  it('forgets an ended transition as another screen covers it', () => {
    remember({ card: NIGHT_TRAIN })
    coverScreen({ screen: HOME })
    returnScreen({ screen: HOME })
    coverScreen({ screen: HOME })
    takeOpener({ screen: HOME, card: NIGHT_TRAIN })
    expect(phaseOf({ screen: HOME, card: NIGHT_TRAIN })).toBe(RESTORE_PHASES.none)
  })

  it('asks nothing again once another screen covers this one before the transition ends', () => {
    remember({ card: NIGHT_TRAIN })
    coverScreen({ screen: HOME })
    takeOpener({ screen: HOME, card: NIGHT_TRAIN })
    coverScreen({ screen: HOME })
    returnScreen({ screen: HOME })
    expect(phaseOf({ screen: HOME, card: NIGHT_TRAIN })).toBe(RESTORE_PHASES.none)
  })

  it('names the card taking the focus back only while it returns or is asked', () => {
    const now = () => restoringCardOf(restoreIn({ state: useScreenFocus.getState(), screen: HOME }))
    remember({ card: NIGHT_TRAIN })
    expect(now()).toBeNull()
    coverScreen({ screen: HOME })
    takeOpener({ screen: HOME, card: NIGHT_TRAIN })
    expect(now()).toEqual({ card: NIGHT_TRAIN, shelf: FILMS })
    returnScreen({ screen: HOME })
    expect(now()).toEqual({ card: NIGHT_TRAIN, shelf: FILMS })
    spendAsk({ screen: HOME })
    expect(now()).toBeNull()
  })
})
