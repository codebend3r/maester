import { describe, expect, it } from 'bun:test'

import {
  MENU_MOVES,
  hasEdgeSwipe,
  isClosedBy,
  isOpenedBy,
  isPlayerPath,
  menuMoveOf,
  menuWidthOf,
} from '@/layouts/touchMenuKit'

describe('menuWidthOf', () => {
  it('takes most of a phone and stops at a width a tablet can bear', () => {
    expect(menuWidthOf(390)).toBe(328)
    expect(menuWidthOf(1024)).toBe(360)
  })
})

describe('the drag', () => {
  it('opens past 80 points, or on a flick', () => {
    expect(isOpenedBy({ dx: 100, vx: 0 })).toBe(true)
    expect(isOpenedBy({ dx: 40, vx: 0.1 })).toBe(false)
    expect(isOpenedBy({ dx: 40, vx: 0.9 })).toBe(true)
  })

  it('shuts past 80 points back, or on a flick', () => {
    expect(isClosedBy({ dx: -100, vx: 0 })).toBe(true)
    expect(isClosedBy({ dx: -40, vx: -0.1 })).toBe(false)
    expect(isClosedBy({ dx: -40, vx: -0.9 })).toBe(true)
  })
})

describe('where the menu goes', () => {
  it('stacks on Home and replaces everywhere else', () => {
    expect(menuMoveOf({ pathname: '/' })).toBe(MENU_MOVES.push)
    expect(menuMoveOf({ pathname: '/library/3' })).toBe(MENU_MOVES.replace)
  })

  it('keeps off the player and pulls from Home only', () => {
    expect(isPlayerPath({ pathname: '/play/20' })).toBe(true)
    expect(isPlayerPath({ pathname: '/playlist/2' })).toBe(false)
    expect(hasEdgeSwipe({ pathname: '/' })).toBe(true)
    expect(hasEdgeSwipe({ pathname: '/settings' })).toBe(false)
  })
})
