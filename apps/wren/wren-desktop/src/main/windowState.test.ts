import { describe, expect, it } from 'bun:test'
import { FIRST_SIZE, isWindowBounds, placeWindow } from '@/main/windowState'

const SCREEN = { x: 0, y: 25, width: 1512, height: 920 }
const SAVED = { x: 100, y: 80, width: 1100, height: 700 }

describe('placeWindow', () => {
  it('opens at the first size the first time', () => {
    expect(placeWindow({ saved: null, areas: [SCREEN] })).toEqual(FIRST_SIZE)
  })

  it('opens where it was last while a display still shows it', () => {
    expect(placeWindow({ saved: SAVED, areas: [SCREEN] })).toEqual(SAVED)
  })

  it('comes back to the main display once the one it was on is gone', () => {
    const offScreen = { ...SAVED, x: 4000 }
    expect(placeWindow({ saved: offScreen, areas: [SCREEN] })).toEqual(FIRST_SIZE)
  })

  it('ignores a saved file it did not write, or a window smaller than the smallest', () => {
    expect(isWindowBounds({ x: '1', y: 2, width: 800, height: 600 })).toBe(false)
    expect(isWindowBounds({ ...SAVED, width: 100 })).toBe(false)
    expect(placeWindow({ saved: { ...SAVED, height: 1.5 }, areas: [SCREEN] })).toEqual(FIRST_SIZE)
  })
})
