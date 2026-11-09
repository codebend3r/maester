import { describe, expect, it } from 'bun:test'
import { WATCHED_STATES } from '@raven/core'

import {
  CARD_MENU_COPY,
  bingeOptionOf,
  favouriteOptionOf,
  isOptionBlocked,
  readingNoteOf,
  watchedOptionOf,
} from '@/cardMenu/menuOptions'

describe('watchedOptionOf', () => {
  it('offers to mark what is not all watched, and to unmark what is', () => {
    const pressed: string[] = []
    const mark = watchedOptionOf({
      state: WATCHED_STATES.partly,
      onToggle: () => pressed.push('toggled'),
    })
    expect(mark.label).toBe(CARD_MENU_COPY.markWatched)
    expect(isOptionBlocked(mark)).toBe(false)
    mark.onPress()
    expect(pressed).toEqual(['toggled'])
    expect(
      watchedOptionOf({ state: WATCHED_STATES.watched, onToggle: () => undefined }).label,
    ).toBe(CARD_MENU_COPY.markUnwatched)
  })
})

describe('favouriteOptionOf', () => {
  it('adds a title that is no favourite and removes one that is, sending the new mark', () => {
    const marks: boolean[] = []
    const add = favouriteOptionOf({ isOn: false, onToggle: (isMarked) => marks.push(isMarked) })
    const remove = favouriteOptionOf({ isOn: true, onToggle: (isMarked) => marks.push(isMarked) })
    expect(add.label).toBe(CARD_MENU_COPY.addFavourite)
    expect(remove.label).toBe(CARD_MENU_COPY.removeFavourite)
    add.onPress()
    remove.onPress()
    expect(marks).toEqual([true, false])
  })
})

describe('bingeOptionOf', () => {
  it('adds a show, removes one binging, and says why it cannot while the list is full', () => {
    const toggle = () => undefined
    expect(bingeOptionOf({ isBinging: false, isFull: false, toggle }).label).toBe(
      CARD_MENU_COPY.addBinge,
    )
    expect(bingeOptionOf({ isBinging: true, isFull: false, toggle }).label).toBe(
      CARD_MENU_COPY.removeBinge,
    )
    const full = bingeOptionOf({ isBinging: false, isFull: true, toggle })
    expect(full.blockedBy).toBe(CARD_MENU_COPY.bingeFull)
    expect(isOptionBlocked(full)).toBe(true)
  })
})

describe('readingNoteOf', () => {
  it('says the title is being read, or that the read failed', () => {
    expect(readingNoteOf(false)).toBe(CARD_MENU_COPY.reading)
    expect(readingNoteOf(true)).toBe(CARD_MENU_COPY.failed)
  })
})
