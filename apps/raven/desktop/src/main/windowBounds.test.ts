import { describe, expect, it } from 'bun:test'
import { DEFAULT_SIZE, placeWindow, type Rect } from '@/main/windowBounds'

const PRIMARY: Rect = { x: 0, y: 25, width: 1920, height: 1050 }
const SIDE: Rect = { x: 1920, y: 0, width: 2560, height: 1440 }

const DISPLAYS = [
  { id: 1, workArea: PRIMARY },
  { id: 2, workArea: SIDE },
]

const centredDefault = (workArea: Rect): Rect => ({
  x: workArea.x + (workArea.width - DEFAULT_SIZE.width) / 2,
  y: workArea.y + (workArea.height - DEFAULT_SIZE.height) / 2,
  width: DEFAULT_SIZE.width,
  height: DEFAULT_SIZE.height,
})

describe('placeWindow', () => {
  it('reopens on the display it closed on', () => {
    const saved = { x: 2100, y: 100, width: 1400, height: 900, displayId: 2 }
    expect(placeWindow({ saved, displays: DISPLAYS, primary: { workArea: PRIMARY } })).toEqual({
      x: 2100,
      y: 100,
      width: 1400,
      height: 900,
    })
  })

  it('opens at the default size, centred on the main display, without saved bounds', () => {
    expect(
      placeWindow({ saved: null, displays: DISPLAYS, primary: { workArea: PRIMARY } }),
    ).toEqual(centredDefault(PRIMARY))
  })

  it('falls back to the main display when the saved one is gone', () => {
    const saved = { x: 2100, y: 100, width: 1400, height: 900, displayId: 9 }
    expect(placeWindow({ saved, displays: DISPLAYS, primary: { workArea: PRIMARY } })).toEqual(
      centredDefault(PRIMARY),
    )
  })

  it('falls back when too little of the window is left on its display', () => {
    const saved = {
      x: SIDE.x + SIDE.width - 10,
      y: 100,
      width: 1400,
      height: 900,
      displayId: 2,
    }
    expect(placeWindow({ saved, displays: DISPLAYS, primary: { workArea: PRIMARY } })).toEqual(
      centredDefault(PRIMARY),
    )
  })

  it('keeps a window with exactly 64 by 64 pixels on its display, moved fully onto it', () => {
    const saved = {
      x: SIDE.x + SIDE.width - 64,
      y: SIDE.y + SIDE.height - 64,
      width: 800,
      height: 600,
      displayId: 2,
    }
    expect(placeWindow({ saved, displays: DISPLAYS, primary: { workArea: PRIMARY } })).toEqual({
      x: SIDE.x + SIDE.width - 800,
      y: SIDE.y + SIDE.height - 600,
      width: 800,
      height: 600,
    })
  })

  it('brings a window saved above the top of its work area down, so its title bar can be reached', () => {
    const saved = { x: 100, y: PRIMARY.y - 500, width: 800, height: 600, displayId: 1 }
    expect(placeWindow({ saved, displays: DISPLAYS, primary: { workArea: PRIMARY } })).toEqual({
      x: 100,
      y: PRIMARY.y,
      width: 800,
      height: 600,
    })
  })

  it('brings a window saved left of its work area back onto it', () => {
    const saved = { x: SIDE.x - 700, y: 100, width: 800, height: 600, displayId: 2 }
    expect(placeWindow({ saved, displays: DISPLAYS, primary: { workArea: PRIMARY } })).toEqual({
      x: SIDE.x,
      y: 100,
      width: 800,
      height: 600,
    })
  })

  it('clamps saved bounds larger than their display to its work area', () => {
    const saved = { x: 0, y: 25, width: 3000, height: 2000, displayId: 1 }
    expect(placeWindow({ saved, displays: DISPLAYS, primary: { workArea: PRIMARY } })).toEqual({
      x: 0,
      y: 25,
      width: PRIMARY.width,
      height: PRIMARY.height,
    })
  })

  it('falls back when clamping leaves the window off its display', () => {
    const saved = { x: -5000, y: 25, width: 6000, height: 900, displayId: 1 }
    expect(placeWindow({ saved, displays: DISPLAYS, primary: { workArea: PRIMARY } })).toEqual(
      centredDefault(PRIMARY),
    )
  })

  it('clamps the default to a small main display', () => {
    const small: Rect = { x: 0, y: 0, width: 1024, height: 700 }
    expect(
      placeWindow({
        saved: null,
        displays: [{ id: 1, workArea: small }],
        primary: { workArea: small },
      }),
    ).toEqual({ x: 0, y: 0, width: 1024, height: 700 })
  })
})
