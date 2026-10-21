import { beforeEach, describe, expect, it } from 'bun:test'

import {
  coverScreen,
  drawCard,
  isOpeningIn,
  leaveScreen,
  rememberOpener,
  returnScreen,
  settleScreen,
  takeOpener,
  useScreenFocus,
} from '@/stores/screenFocus'

const HOME = 'home-route'
const ITEM = 'item-route'
const NIGHT_TRAIN = 'library:1/media:3'
const BUSBOYS = 'library:1/media:2'

describe('screen focus', () => {
  beforeEach(() => useScreenFocus.setState({ screens: {} }))

  it('keeps a screen opening until something on it has the focus', () => {
    expect(isOpeningIn({ state: useScreenFocus.getState(), screen: HOME })).toBe(true)
    settleScreen({ screen: HOME })
    expect(isOpeningIn({ state: useScreenFocus.getState(), screen: HOME })).toBe(false)
    expect(isOpeningIn({ state: useScreenFocus.getState(), screen: ITEM })).toBe(true)
  })

  it('hands the opener back once, and only to the card it names', () => {
    rememberOpener({ screen: HOME, card: NIGHT_TRAIN })
    expect(takeOpener({ screen: HOME, card: BUSBOYS })).toBe(false)
    expect(takeOpener({ screen: ITEM, card: NIGHT_TRAIN })).toBe(false)
    expect(takeOpener({ screen: HOME, card: NIGHT_TRAIN })).toBe(true)
    expect(takeOpener({ screen: HOME, card: NIGHT_TRAIN })).toBe(false)
  })

  it('counts opening a card as having had the focus', () => {
    rememberOpener({ screen: HOME, card: NIGHT_TRAIN })
    expect(isOpeningIn({ state: useScreenFocus.getState(), screen: HOME })).toBe(false)
  })

  it('keeps the opener through the cover the card opened, for the card to take on return', () => {
    rememberOpener({ screen: HOME, card: NIGHT_TRAIN })
    coverScreen({ screen: HOME })
    expect(takeOpener({ screen: HOME, card: NIGHT_TRAIN })).toBe(true)
  })

  it('lets an opener no card took go as the screen is covered again', () => {
    rememberOpener({ screen: HOME, card: NIGHT_TRAIN })
    coverScreen({ screen: HOME })
    coverScreen({ screen: HOME })
    expect(takeOpener({ screen: HOME, card: NIGHT_TRAIN })).toBe(false)
    expect(isOpeningIn({ state: useScreenFocus.getState(), screen: HOME })).toBe(false)
  })

  it('keeps a new opener through its own cover, whatever the last one left', () => {
    rememberOpener({ screen: HOME, card: NIGHT_TRAIN })
    coverScreen({ screen: HOME })
    rememberOpener({ screen: HOME, card: BUSBOYS })
    coverScreen({ screen: HOME })
    expect(takeOpener({ screen: HOME, card: BUSBOYS })).toBe(true)
  })

  it('forgets a screen that has gone, so one opened in its place starts afresh', () => {
    rememberOpener({ screen: HOME, card: NIGHT_TRAIN })
    rememberOpener({ screen: ITEM, card: BUSBOYS })
    leaveScreen({ screen: HOME })
    expect(useScreenFocus.getState().screens).toEqual({
      [ITEM]: { hasSettled: true, opener: { card: BUSBOYS, isDrawn: true, hasBeenCovered: false } },
    })
    expect(isOpeningIn({ state: useScreenFocus.getState(), screen: HOME })).toBe(true)
  })

  it('opens a screen again on a return whose opener has gone, its shelf with it', () => {
    rememberOpener({ screen: HOME, card: NIGHT_TRAIN })
    coverScreen({ screen: HOME })
    drawCard({ screen: HOME, card: NIGHT_TRAIN, isDrawn: false })
    returnScreen({ screen: HOME })
    expect(isOpeningIn({ state: useScreenFocus.getState(), screen: HOME })).toBe(true)
    expect(takeOpener({ screen: HOME, card: NIGHT_TRAIN })).toBe(false)
  })

  it('leaves the opener to its card when the card was drawn afresh while covered', () => {
    rememberOpener({ screen: HOME, card: NIGHT_TRAIN })
    coverScreen({ screen: HOME })
    drawCard({ screen: HOME, card: NIGHT_TRAIN, isDrawn: false })
    drawCard({ screen: HOME, card: NIGHT_TRAIN, isDrawn: true })
    returnScreen({ screen: HOME })
    expect(isOpeningIn({ state: useScreenFocus.getState(), screen: HOME })).toBe(false)
    expect(takeOpener({ screen: HOME, card: NIGHT_TRAIN })).toBe(true)
  })

  it("hears only the opener's own card come and go", () => {
    rememberOpener({ screen: HOME, card: NIGHT_TRAIN })
    drawCard({ screen: HOME, card: BUSBOYS, isDrawn: false })
    drawCard({ screen: ITEM, card: NIGHT_TRAIN, isDrawn: false })
    returnScreen({ screen: HOME })
    expect(takeOpener({ screen: HOME, card: NIGHT_TRAIN })).toBe(true)
    expect(useScreenFocus.getState().screens[ITEM]).toBeUndefined()
  })
})
