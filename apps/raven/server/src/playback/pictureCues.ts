import type { CuePicture, PictureCue } from '@raven/core'
import { type PgsDisplay, readPgs } from '@/playback/pgs'
import { pgsPngOf } from '@/playback/pgsPng'

const cuePicturesOf = ({ pictures }: PgsDisplay): CuePicture[] =>
  pictures.flatMap((picture) => {
    const { png, width, height } = pgsPngOf(picture)
    return width === 0 || height === 0
      ? []
      : [{ x: picture.x, y: picture.y, width, height, png: png.toString('base64') }]
  })

type PictureCuesOfProps = {
  /** A stretch of a PGS track as ffmpeg's `sup` muxer writes it. */
  sup: Buffer
  /** Where the stretch ends on the file's clock, in seconds. */
  end: number
  /** Whether the video is HDR, whose disc writes the subtitle's colours on the picture's curve. */
  isHdr: boolean
}

/**
 * A stretch of a Blu-ray PGS track as picture cues. Each display set that shows something is a
 * cue from its own time to the next set's, which replaces or clears it; one still up where the
 * stretch ends is cut short at `end`, and comes whole in the stretch after.
 */
export const pictureCuesOf = ({ sup, end, isHdr }: PictureCuesOfProps): PictureCue[] =>
  readPgs({ sup, isHdr }).flatMap((display, index, displays) => {
    const pictures = cuePicturesOf(display)
    const until = displays[index + 1]?.pts ?? end
    return pictures.length === 0 || until <= display.pts
      ? []
      : [{ start: display.pts, end: until, canvas: display.canvas, pictures }]
  })
