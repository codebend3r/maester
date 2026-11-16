import { describe, expect, it } from 'bun:test'

import { placedPictureOf } from '@/layouts/pictureCaptionFit'

const CANVAS = { width: 1920, height: 1080 }

const LINE = { x: 480, y: 900, width: 960, height: 120 }

describe('placedPictureOf', () => {
  it('scales a picture with its canvas where the canvas fills the frame', () => {
    expect(
      placedPictureOf({ frame: { width: 960, height: 540 }, canvas: CANVAS, picture: LINE }),
    ).toEqual({ left: 240, top: 450, width: 480, height: 60 })
  })

  it('centres the canvas between the bars of a taller frame, as the video is', () => {
    // A 4:3 tablet: the 16:9 canvas is 960 by 540 with 90 points of bar above and below.
    expect(
      placedPictureOf({ frame: { width: 960, height: 720 }, canvas: CANVAS, picture: LINE }),
    ).toEqual({ left: 240, top: 540, width: 480, height: 60 })
  })

  it('centres the canvas between the bars of a wider frame', () => {
    expect(
      placedPictureOf({ frame: { width: 1200, height: 540 }, canvas: CANVAS, picture: LINE }),
    ).toEqual({ left: 360, top: 450, width: 480, height: 60 })
  })

  it('places nothing on a canvas or in a frame with no size', () => {
    expect(
      placedPictureOf({ frame: { width: 0, height: 0 }, canvas: CANVAS, picture: LINE }),
    ).toBeNull()
    expect(
      placedPictureOf({
        frame: { width: 960, height: 540 },
        canvas: { width: 0, height: 1080 },
        picture: LINE,
      }),
    ).toBeNull()
  })
})
