import { beforeEach, describe, expect, it } from 'bun:test'

import {
  coverScreen,
  isOpeningIn,
  leaveScreen,
  rememberOpener,
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
      [ITEM]: { hasSettled: true, opener: { card: BUSBOYS, hasBeenCovered: false } },
    })
    expect(isOpeningIn({ state: useScreenFocus.getState(), screen: HOME })).toBe(true)
  })
})
